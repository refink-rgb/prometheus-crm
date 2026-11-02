// Reads for the Dashboard. One pass, shared by all three tabs: the Financial
// tab's "revenue at risk" needs the concern scores, and the concern scores need
// the revenue, so splitting the reads per tab would only duplicate them.

import type { createClient } from '@/lib/supabase/server'
import { easternDateOf } from '@/lib/eastern'
import { fetchLpDailyAll } from '@/lib/results-queries'
import { computeRevenue, type RevenueSummary } from '@/lib/revenue/metrics'
import {
  computeConcerns,
  computeManagement,
  projectTimings,
  type ClientConcern,
  type ManagementData,
  type OpsBrand,
  type OpsEvent,
  type OpsOffer,
  type OpsProject,
  type OpsTracking,
} from './ops'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// Postgres says 42P01 for a missing table; newer PostgREST says PGRST205.
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
const PAGE = 1000

// PostgREST caps responses at 1000 rows; page until a short page comes back.
async function paged<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>,
): Promise<{ rows: T[]; error: { message: string; code?: string } | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) return { rows, error }
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE || rows.length >= 50_000) break
  }
  return { rows, error: null }
}

export interface RevenueUploadInfo {
  id: string
  fileName: string
  uploadedAt: string
  uploadedBy: string | null
  lineCount: number
  unmatched: string[]
}

export interface DashboardData {
  today: string
  revenue: RevenueSummary | null
  upload: RevenueUploadInfo | null
  revenueTablesMissing: boolean
  management: ManagementData
  concerns: ClientConcern[]
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
}

export async function loadDashboard(supabase: SupabaseClient, today: string): Promise<DashboardData> {
  const thisMonth = today.slice(0, 7)
  const [y, m] = thisMonth.split('-').map(Number)
  const offersFrom = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 10)

  const [brandsRes, projectsRes, eventsRes, offersRes, trackingRes, uploadRes] = await Promise.all([
    supabase.from('brands').select('id, name, is_active, cod_value, cod_mode'),
    paged<OpsProject>((from, to) =>
      supabase.from('projects')
        .select('id, name, brand_id, due_date, is_complete, lp_stage, creatives_stage')
        .order('id')
        .range(from, to)),
    paged<{ card_id: string; card_kind: 'production' | 'offer'; track: 'lp' | 'creative' | null; to_stage: string; created_at: string }>((from, to) =>
      supabase.from('pipeline_events')
        .select('card_id, card_kind, track, to_stage, created_at')
        .eq('event_type', 'stage_changed')
        .in('to_stage', ['live', 'client_review', 'offer_approved'])
        .order('created_at')
        .range(from, to)),
    supabase.from('offer_cards')
      .select('id, brand_id, name, target_month, stage, client_approved_at')
      .gte('target_month', offersFrom),
    supabase.from('lp_tracking').select('id, project_id, brand_id, launched_on, ended_on'),
    supabase.from('revenue_uploads')
      .select('id, file_name, months, targets, line_count, uploaded_by_email, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(1),
  ])

  const brands = (brandsRes.data ?? []) as OpsBrand[]
  const brandName = new Map(brands.map(b => [b.id, b.name]))
  const projects = projectsRes.rows
  const events: OpsEvent[] = eventsRes.rows.map(e => ({
    card_id: e.card_id,
    card_kind: e.card_kind,
    track: e.track,
    to_stage: e.to_stage,
    date: easternDateOf(e.created_at),
  }))
  const offers: OpsOffer[] = ((offersRes.data ?? []) as Array<Omit<OpsOffer, 'client_approved_at'> & { client_approved_at: string | null }>)
    .map(o => ({ ...o, client_approved_at: o.client_approved_at ? easternDateOf(o.client_approved_at) : null }))

  // --- Revenue ----------------------------------------------------------------
  const revenueTablesMissing = MISSING_TABLE.has(uploadRes.error?.code ?? '')
  const latest = (uploadRes.data ?? [])[0] as
    | { id: string; file_name: string; months: string[]; targets: Record<string, number>; line_count: number; uploaded_by_email: string | null; uploaded_at: string }
    | undefined

  let revenue: RevenueSummary | null = null
  let upload: RevenueUploadInfo | null = null
  if (latest) {
    const linesRes = await paged<{ client_name: string; service: string; brand_id: string | null; months: Record<string, number> }>((from, to) =>
      supabase.from('revenue_lines')
        .select('client_name, service, brand_id, months')
        .eq('upload_id', latest.id)
        .order('row_number')
        .range(from, to))
    const lines = linesRes.rows
    revenue = computeRevenue(
      lines.map(l => ({ clientName: l.client_name, service: l.service, brandId: l.brand_id, months: l.months ?? {} })),
      latest.months ?? [],
      latest.targets ?? {},
      thisMonth,
    )
    upload = {
      id: latest.id,
      fileName: latest.file_name,
      uploadedAt: latest.uploaded_at,
      uploadedBy: latest.uploaded_by_email,
      lineCount: latest.line_count,
      unmatched: [...new Set(lines.filter(l => !l.brand_id).map(l => l.client_name))].sort((a, b) => a.localeCompare(b)),
    }
  }

  // --- Results (recent launches only) ---------------------------------------------
  const recentCut = new Date(Date.parse(`${today}T00:00:00Z`) - 95 * 86_400_000).toISOString().slice(0, 10)
  const trackingRows = ((trackingRes.data ?? []) as Array<Omit<OpsTracking, 'daily'>>)
    .filter(t => t.launched_on && (t.ended_on === null || t.launched_on >= recentCut))
  const daily = trackingRows.length > 0 ? await fetchLpDailyAll(supabase, trackingRows.map(t => t.id)) : []
  const dailyByTracking = new Map<string, OpsTracking['daily']>()
  for (const d of daily) {
    const list = dailyByTracking.get(d.lp_tracking_id) ?? []
    list.push({ stat_date: d.stat_date, spend_cents: d.spend_cents, revenue_cents: d.revenue_cents })
    dailyByTracking.set(d.lp_tracking_id, list)
  }
  const trackings: OpsTracking[] = trackingRows.map(t => ({ ...t, daily: dailyByTracking.get(t.id) ?? [] }))

  // --- Ops ----------------------------------------------------------------------
  const timings = projectTimings(projects, events, brandName, today)

  // MM clients this month, by the sheet: they're owed 2 moments.
  const mmClientKeys = revenue
    ? new Set(revenue.clients.filter(c => c.currentServices.includes('MM')).map(c => c.key))
    : null

  const management = computeManagement({
    brands, projects, events, offers, timings,
    revenueClients: revenue?.clients ?? null,
    mmClientKeys,
    today,
  })

  const concerns = computeConcerns({
    brands,
    timings,
    lateOffers: management.lateOffers,
    clientWaits: management.clientWaits,
    trackings,
    projectName: new Map(projects.map(p => [p.id, p.name])),
    revenueClients: revenue?.clients ?? null,
    nextMonthLabel: revenue?.next ? monthLabel(revenue.next.month) : null,
    today,
  })

  return { today, revenue, upload, revenueTablesMissing, management, concerns }
}
