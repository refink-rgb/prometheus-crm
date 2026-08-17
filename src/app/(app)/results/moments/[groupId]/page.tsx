import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import FreshnessStamp from '@/components/FreshnessStamp'
import CampaignDailyCharts from '@/components/CampaignDailyCharts'
import DailyResultsTable from '@/components/DailyResultsTable'
import BrandCodEditor from '@/components/BrandCodEditor'
import { fetchDailyResults } from '@/lib/results-queries'
import {
  sumResults,
  cumulativeSeries,
  sortByDate,
  daysLive,
  missingDates,
  combineDailyByDate,
  trackedLabel,
  formatCents,
  formatRoas,
  formatCount,
  formatPercent,
  shortDateLabel,
  safeRate,
  contributionMargin,
  breakEvenRoas,
  type BrandCod,
  type TrackedCampaign,
} from '@/lib/results'

export const maxDuration = 60

interface MemberRow extends TrackedCampaign {
  projects: { id: string; name: string } | null
  brands: ({ id: string; name: string } & BrandCod) | null
}

// The combined view for a moment split across two or more tracked entities
// (a prospecting ad set + a retention ad set, most often). This page is
// deliberately READ-ONLY for daily corrections — a combined day is a sum
// across members, and "correcting" a sum without knowing which member's
// number was wrong would just be guessing. Corrections happen on each
// member's own page, linked below.
export default async function MomentResultsPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = await canEdit(user.email)
  if (!isEditor) redirect('/')

  const today = easternToday()

  const { data: membersRaw } = await supabase
    .from('tracked_campaigns')
    .select('id, project_id, brand_id, meta_ad_account_id, meta_campaign_id, campaign_name, meta_adset_id, adset_name, moment_group_id, moment_group_label, launched_on, ended_on, created_at, projects(id, name), brands(id, name, cod_value, cod_mode)')
    .eq('moment_group_id', groupId)
    .order('launched_on', { ascending: true })

  const members = (membersRaw ?? []) as unknown as MemberRow[]
  if (members.length === 0) notFound()

  const representative = members[0]
  const label = representative.moment_group_label ?? 'Combined moment'

  const { rows: allDaily } = await fetchDailyResults(supabase, members.map(m => m.id))
  const dailyByMember = new Map<string, typeof allDaily>()
  for (const r of allDaily) {
    const list = dailyByMember.get(r.tracked_campaign_id)
    if (list) list.push(r)
    else dailyByMember.set(r.tracked_campaign_id, [r])
  }

  const rows = combineDailyByDate(members.map(m => sortByDate(dailyByMember.get(m.id) ?? [])))
  const nowMs = new Date().getTime()
  const totals = sumResults(rows)
  const series = cumulativeSeries(rows)

  const launchedOn = members.reduce((min, m) => (m.launched_on < min ? m.launched_on : min), representative.launched_on)
  const anyLive = members.some(m => m.ended_on === null)
  const endedOn = anyLive ? null : members.reduce((max, m) => (m.ended_on && m.ended_on > (max ?? '') ? m.ended_on : max), null as string | null)
  const live = daysLive(launchedOn, endedOn, today)

  const gaps = missingDates(rows, launchedOn, previousDay(today))
  const flagged = rows.filter(r => r.warnings.length > 0)

  const overallLpConv = totals.landing_page_views === null
    ? null
    : safeRate(totals.purchases, totals.landing_page_views)

  const cod: BrandCod = representative.brands
    ? { cod_value: representative.brands.cod_value, cod_mode: representative.brands.cod_mode }
    : { cod_value: null, cod_mode: 'percent' }
  const margin = contributionMargin(cod, totals.revenue_cents, totals.spend_cents, totals.purchases)
  const be = breakEvenRoas(cod)

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Link href="/results" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Results</Link>
        {representative.brands && (
          <>
            <span style={{ opacity: 0.5 }}>/</span>
            <Link href={`/brands/${representative.brand_id}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              {representative.brands.name}
            </Link>
          </>
        )}
        {representative.projects && (
          <>
            <span style={{ opacity: 0.5 }}>/</span>
            <Link
              href={`/brands/${representative.brand_id}/projects/${representative.project_id}`}
              style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
            >
              {representative.projects.name}
            </Link>
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            {label}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <span className="badge badge-in_progress" style={{ marginRight: 6 }}>combined moment</span>
            Launched {shortDateLabel(launchedOn)} · day {live}
            {endedOn && ` · tracking ended ${shortDateLabel(endedOn)}`}
          </div>
        </div>
        <FreshnessStamp rows={rows} nowMs={nowMs} />
      </div>

      {/* The members this combines. Each links to its OWN page, where the
          daily table and the Correct button actually live — this page is
          the sum, not the place to fix one day of it. */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        {members.map(m => (
          <Link
            key={m.id}
            href={`/results/${m.id}`}
            className="badge badge-brief"
            style={{ textDecoration: 'none' }}
          >
            {trackedLabel(m)} →
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{
          background: 'var(--surface-1)',
          border: '1px dashed var(--border-strong)',
          borderRadius: 12,
          padding: '24px 28px',
          color: 'var(--text-muted)',
          fontSize: 13,
          lineHeight: 1.7,
          maxWidth: 640,
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>No results pulled yet for either member.</strong>
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
          }}>
            <Tile label="Spend" value={formatCents(totals.spend_cents)} sub="since launch, combined" />
            <Tile label="Revenue" value={formatCents(totals.revenue_cents)} sub="since launch, combined" />
            <Tile label="ROAS" value={formatRoas(totals.roas)} sub="spend-weighted, combined" />
            <Tile label="Purchases" value={formatCount(totals.purchases)} sub="since launch, combined" />
            <Tile label="CPA" value={formatCents(totals.cpa_cents)} sub="spend ÷ purchases" />
            <Tile
              label="Incremental revenue"
              value={formatCents(totals.incremental_revenue_cents)}
              sub={totals.incremental_revenue_cents === null ? 'not reported' : 'as reported'}
            />
            <Tile label="LP conversion" value={formatPercent(overallLpConv)} sub="purchases ÷ LP views" />
            <Tile
              label="Contribution margin"
              value={formatCents(margin.cm_cents)}
              sub={margin.cm_cents === null ? 'set a COD below' : 'revenue − delivery − spend'}
            />
          </div>

          {be !== null && totals.roas !== null && (
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <Notice tone={totals.roas >= be ? 'muted' : 'warn'}>
                Break-even ROAS for {representative.brands?.name ?? 'this brand'} is{' '}
                <strong>{formatRoas(be)}</strong>. Combined, this moment is running at{' '}
                <strong>{formatRoas(totals.roas)}</strong> —{' '}
                {totals.roas >= be ? 'above break-even, so it is contributing margin.' : 'below break-even, so it is losing money on every order.'}
              </Notice>
            </div>
          )}

          {(gaps.length > 0 || flagged.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
              {gaps.length > 0 && (
                <Notice tone="muted">
                  <strong>{gaps.length} day{gaps.length === 1 ? '' : 's'} missing</strong> between launch and
                  yesterday: {gaps.slice(0, 12).map(shortDateLabel).join(', ')}
                  {gaps.length > 12 && ` and ${gaps.length - 12} more`}. A day is only a gap here if EVERY
                  member is missing it — check the individual pages above if only one looks off.
                </Notice>
              )}
              {flagged.length > 0 && (
                <Notice tone="warn">
                  <strong>{flagged.length} day{flagged.length === 1 ? '' : 's'} flagged</strong> — at least one
                  member&apos;s number disagreed with itself that day. Open the member pages above for the
                  specific warning; the combined table below shows the union of every flag.
                </Notice>
              )}
            </div>
          )}

          <div style={{ marginBottom: 'var(--space-8)' }}>
            <CampaignDailyCharts points={series} />
          </div>

          {representative.brands && (
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <BrandCodEditor
                brandId={representative.brands.id}
                brandName={representative.brands.name}
                cod={cod}
                canEdit={isEditor}
              />
            </div>
          )}

          {/* Read-only: canEdit is hard-false here regardless of the viewer's
              real permissions. A combined day is a sum of members, and
              "correcting" it here would mean guessing which member's number
              was actually wrong — that only makes sense on the member's own
              page, linked above. */}
          <DailyResultsTable rows={rows} trackedCampaignId="combined" canEdit={false} />
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '13px 15px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'muted'; children: React.ReactNode }) {
  const warn = tone === 'warn'
  return (
    <div style={{
      background: warn ? 'rgba(234,179,8,0.08)' : 'var(--surface-1)',
      border: `1px solid ${warn ? 'rgba(234,179,8,0.28)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

function previousDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}
