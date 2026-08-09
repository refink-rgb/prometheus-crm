'use server'

// Friday Capacity Report server actions.
//
// Everyone with CRM access files their own report — including LP and creative
// editors, who are the producers this whole thing is about. That's why there's
// no isJobEditor() guard here (unlike /financials): the people doing the work
// are exactly the people who must be able to submit.
//
// A submission is an UPSERT keyed on (profile_id, week_start). Re-submitting
// on Friday afternoon edits your report rather than stacking a second one, so
// people can fill it in across the day.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { currentWeekStart } from '@/lib/eastern'
import { rotatingQuestionFor } from '@/lib/types'

async function requireProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')

  const profiles = await getCachedProfiles()
  const profile = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  // A profile row is created by the on_auth_user_created trigger, so this only
  // fires if the 20260715 migration was never applied for this user.
  if (!profile) throw new Error('No profile found for your account — ask an admin to check the team roster.')

  return { supabase, profile }
}

function textOrNull(raw: FormDataEntryValue | null): string | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? null : value
}

function intOrNull(raw: FormDataEntryValue | null): number | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}

function hoursOrNull(raw: FormDataEntryValue | null): number | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  // NUMERIC(5,1) in the schema — round to the same precision the column stores
  // so what you typed is what comes back.
  return Math.round(n * 10) / 10
}

export async function submitCapacityReport(formData: FormData): Promise<void> {
  const { supabase, profile } = await requireProfile()

  // The week is server-decided, never taken from the form — otherwise a stale
  // tab open across midnight Friday would file against the wrong week.
  const weekStart = currentWeekStart()

  const { data: report, error: reportErr } = await supabase
    .from('capacity_reports')
    .upsert({
      profile_id: profile.id,
      week_start: weekStart,
      load_rating: intOrNull(formData.get('load_rating')),
      sustainable_moments: intOrNull(formData.get('sustainable_moments')),
      at_risk_next_week: textOrNull(formData.get('at_risk_next_week')),
      briefs_ready: textOrNull(formData.get('briefs_ready')),
      briefs_ready_detail: textOrNull(formData.get('briefs_ready_detail')),
      biggest_blocker: textOrNull(formData.get('biggest_blocker')),
      improvement: textOrNull(formData.get('improvement')),
      rotating_key: rotatingQuestionFor(weekStart).key,
      rotating_answer: textOrNull(formData.get('rotating_answer')),
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,week_start' })
    .select('id')
    .single()

  if (reportErr || !report) {
    throw new Error(`Could not save your report: ${reportErr?.message ?? 'unknown error'}`)
  }

  // Entries are replaced wholesale: the form posts the complete set of rows,
  // and rows the user cleared must disappear. Scoped to this report only.
  const { error: clearErr } = await supabase
    .from('capacity_report_entries')
    .delete()
    .eq('report_id', report.id)
  if (clearErr) throw new Error(`Could not update your moments: ${clearErr.message}`)

  // Rows arrive as entry_<projectId>_<track>_{hours,cause}.
  const rows: Array<Record<string, unknown>> = []
  for (const [key, value] of formData.entries()) {
    const match = /^entry_(.+)_(lp|creative)_hours$/.exec(key)
    if (!match) continue
    const [, projectId, track] = match

    const hours = hoursOrNull(value)
    const cause = textOrNull(formData.get(`entry_${projectId}_${track}_cause`))
    const label = textOrNull(formData.get(`entry_${projectId}_${track}_label`)) ?? 'Unknown moment'

    // Skip untouched rows — a moment you didn't work on shouldn't become a
    // zero-hour data point that drags the averages down.
    if (hours === null && (cause === null || cause === 'on_track')) continue

    rows.push({
      report_id: report.id,
      project_id: projectId,
      project_label: label,
      track,
      focused_hours: hours,
      slip_cause: cause,
    })
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('capacity_report_entries').insert(rows)
    if (insErr) throw new Error(`Could not save your moments: ${insErr.message}`)
  }

  revalidatePath('/capacity')
}
