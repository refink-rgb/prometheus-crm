'use server'

// Revenue sheet upload — the only way revenue gets into the Dashboard.
//
// Each upload becomes a new snapshot (revenue_uploads + its revenue_lines);
// nothing is overwritten, and the dashboard reads the newest snapshot.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canEdit, canViewDashboard } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { easternToday } from '@/lib/eastern'
import { readFirstSheet } from '@/lib/revenue/xlsx'
import { normalizeClientName, parseRevenueSheet } from '@/lib/revenue/sheet'

export interface RevenueUploadState {
  ok: boolean
  message: string
  unmatched?: string[]
  warnings?: string[]
}

const MAX_BYTES = 900 * 1024 // Server Actions cap request bodies at 1MB.

export async function uploadRevenueSheet(
  _prev: RevenueUploadState | null,
  formData: FormData,
): Promise<RevenueUploadState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await canEdit(user.email))) return { ok: false, message: 'Not authorized.' }
  const profiles = await getCachedProfiles()
  const me = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  if (!canViewDashboard(user.email, me)) return { ok: false, message: 'Not authorized.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose an .xlsx file first.' }
  if (!/\.xlsx$/i.test(file.name)) {
    return { ok: false, message: 'Upload the sheet as .xlsx (in Google Sheets: File → Download → Microsoft Excel).' }
  }
  if (file.size > MAX_BYTES) return { ok: false, message: 'That file is over 900 KB. Is it the right sheet?' }

  const yearRaw = Number(formData.get('year'))
  const firstYear = Number.isInteger(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100
    ? yearRaw
    : Number(easternToday().slice(0, 4))

  let parsed
  try {
    const grid = await readFirstSheet(await file.arrayBuffer())
    parsed = parseRevenueSheet(grid, firstYear)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not read that spreadsheet.' }
  }

  const { data: brands, error: brandsErr } = await supabase.from('brands').select('id, name')
  if (brandsErr) return { ok: false, message: `Could not load brands: ${brandsErr.message}` }
  const brandByName = new Map<string, string>()
  for (const b of (brands ?? []) as Array<{ id: string; name: string }>) {
    const k = normalizeClientName(b.name)
    if (k && !brandByName.has(k)) brandByName.set(k, b.id)
  }

  const { data: upload, error: uploadErr } = await supabase
    .from('revenue_uploads')
    .insert({
      file_name: file.name,
      months: parsed.months,
      targets: parsed.targets,
      line_count: parsed.lines.length,
      uploaded_by: user.id,
      uploaded_by_email: user.email ?? null,
    })
    .select('id')
    .single()
  if (uploadErr || !upload) {
    if (uploadErr?.code === '42P01' || uploadErr?.code === 'PGRST205') {
      return { ok: false, message: 'Revenue tables not found. Run supabase/migrations/20261102b_revenue_sheet.sql in the Supabase SQL editor first.' }
    }
    return { ok: false, message: `Could not save the upload: ${uploadErr?.message ?? 'unknown error'}` }
  }

  const unmatched = new Set<string>()
  const rows = parsed.lines.map(l => {
    const brandId = brandByName.get(normalizeClientName(l.clientName)) ?? null
    if (!brandId) unmatched.add(l.clientName)
    return {
      upload_id: upload.id,
      row_number: l.rowNumber,
      client_name: l.clientName,
      service: l.service,
      start_date: l.startDate,
      fee_cents: l.feeCents,
      brand_id: brandId,
      months: l.months,
    }
  })

  const { error: linesErr } = await supabase.from('revenue_lines').insert(rows)
  if (linesErr) {
    // Don't leave a half-written snapshot as the newest one.
    await supabase.from('revenue_uploads').delete().eq('id', upload.id)
    return { ok: false, message: `Could not save the sheet rows: ${linesErr.message}` }
  }

  revalidatePath('/')
  const range = parsed.months.length > 0 ? ` (${parsed.months[0]} to ${parsed.months[parsed.months.length - 1]})` : ''
  return {
    ok: true,
    message: `Uploaded ${parsed.lines.length} lines${range}.`,
    unmatched: [...unmatched].sort((a, b) => a.localeCompare(b)),
    warnings: parsed.warnings.slice(0, 20),
  }
}
