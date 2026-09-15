'use server'

// Campaign results server actions — the human control surface over the daily
// results pipeline.
//
// Kept out of actions.ts (already 1400+ lines and owned by the Production
// Cycle), same reasoning as offer-actions.ts and billing-actions.ts.
//
// Three invariants hold across every action here:
//
//   1. THE MANUAL LINK IS THE CONTRACT. Nothing auto-discovers campaigns.
//      linkCampaign is the only way a campaign enters tracking, and the ingest
//      endpoint rejects anything it hasn't seen here.
//
//   2. ENDING TRACKING IS NOT DELETING HISTORY. endCampaignTracking sets
//      ended_on, which stops the agent fetching new days and drops the card
//      off the live list — every stored day survives. Only unlinkCampaign
//      destroys data, and it says so.
//
//   3. A MANUAL ROW IS NEVER OVERWRITTEN BY THE AGENT. overrideDailyRow sets
//      source='manual', which the ingest endpoint filters out of its upsert.
//      That is the repair path for a day the agent got wrong.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import { parseMoneyToCents, safeRoas, safeCpa, safeRate } from '@/lib/results'

async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) throw new Error('Not authorized.')
  return { supabase, user }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Meta ad account ids are `act_` + digits. Accepting a bare numeric id and
// normalizing it is friendlier than rejecting the most common paste.
function normalizeAdAccountId(raw: string): string | null {
  const t = raw.trim()
  if (/^act_\d+$/.test(t)) return t
  if (/^\d+$/.test(t)) return `act_${t}`
  return null
}

export async function linkCampaign(formData: FormData) {
  const { supabase, user } = await requireEditor()

  const projectId = (formData.get('project_id') as string)?.trim()
  const brandId = (formData.get('brand_id') as string)?.trim()
  const accountRaw = (formData.get('meta_ad_account_id') as string)?.trim() ?? ''
  const campaignId = (formData.get('meta_campaign_id') as string)?.trim() ?? ''
  const campaignName = (formData.get('campaign_name') as string)?.trim() ?? ''
  const launchedOn = (formData.get('launched_on') as string)?.trim() ?? ''
  // Optional. Blank = track the whole campaign; an ID narrows tracking to one
  // ad set, which is how several clients structure marketing moments.
  const adsetIdRaw = (formData.get('meta_adset_id') as string)?.trim() ?? ''
  const adsetName = (formData.get('adset_name') as string)?.trim() ?? ''

  if (!projectId || !brandId) throw new Error('Project and brand are required.')

  const adAccountId = normalizeAdAccountId(accountRaw)
  if (!adAccountId) throw new Error('Ad account ID must look like act_1234567890.')
  if (!ISO_DATE.test(launchedOn)) throw new Error('Launch date is required (YYYY-MM-DD).')

  const adsetId = adsetIdRaw === '' ? null : adsetIdRaw
  if (adsetId !== null && !/^\d+$/.test(adsetId)) {
    throw new Error('Ad set ID must be the numeric Meta ad set ID.')
  }

  // IDENTITY: the ad set id when tracking an ad set, the campaign id when
  // tracking a whole campaign. Exactly one is required, and only the identity
  // is mandatory — Meta object IDs are globally unique, so an ad set id needs
  // nothing beside it.
  if (adsetId === null) {
    if (!/^\d+$/.test(campaignId)) {
      throw new Error('Enter either a campaign ID (to track the whole campaign) or an ad set ID (to track one moment inside it).')
    }
    if (!campaignName) {
      throw new Error('Campaign name is required — it is the label the Results tab shows.')
    }
  } else if (campaignId !== '' && !/^\d+$/.test(campaignId)) {
    // Optional context when tracking an ad set, but a malformed value would be
    // stored and shown, so it still has to be a number if given at all.
    throw new Error('Campaign ID must be numeric, or left blank — the agent fills it in from Meta.')
  }

  // A launch date in the future would make the work list ask the agent for
  // days that haven't happened, and every one would be rejected as future.
  const today = easternToday()
  if (launchedOn > today) throw new Error('Launch date cannot be in the future.')

  const { error } = await supabase.from('tracked_campaigns').insert({
    project_id: projectId,
    brand_id: brandId,
    meta_ad_account_id: adAccountId,
    // Null on an ad-set row unless you happened to paste it. The agent
    // backfills both from Meta on its first pull.
    meta_campaign_id: campaignId === '' ? null : campaignId,
    campaign_name: campaignName === '' ? null : campaignName,
    meta_adset_id: adsetId,
    adset_name: adsetId === null ? null : (adsetName === '' ? null : adsetName),
    launched_on: launchedOn,
    created_by: user.id,
  })

  if (error) {
    // uq_tracked_campaigns_meta_ids, now keyed on
    // (account, campaign, COALESCE(adset,'')). Linking the same thing to two
    // projects would double-count it in the header tiles.
    if (error.code === '23505') {
      throw new Error(adsetId
        ? 'That ad set is already tracked — it can only be linked to one project.'
        : 'That campaign is already tracked — it can only be linked to one project.')
    }
    throw new Error(`Failed to link campaign: ${error.message}`)
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/results')
}

// Stops the agent fetching new days and drops the campaign off the live list.
// EVERY STORED DAY SURVIVES — this is the normal way a campaign leaves the
// Results tab.
export async function endCampaignTracking(trackedCampaignId: string, projectId: string, brandId: string) {
  const { supabase } = await requireEditor()

  const { error } = await supabase
    .from('tracked_campaigns')
    .update({ ended_on: easternToday() })
    .eq('id', trackedCampaignId)

  if (error) throw new Error(`Failed to end tracking: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/results')
  revalidatePath(`/results/${trackedCampaignId}`)
}

// Puts an ended campaign back on the live list. The work list will re-pull a
// trailing window from the last day held, so a short pause self-heals.
export async function resumeCampaignTracking(trackedCampaignId: string, projectId: string, brandId: string) {
  const { supabase } = await requireEditor()

  const { error } = await supabase
    .from('tracked_campaigns')
    .update({ ended_on: null })
    .eq('id', trackedCampaignId)

  if (error) throw new Error(`Failed to resume tracking: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/results')
  revalidatePath(`/results/${trackedCampaignId}`)
}

// DESTRUCTIVE. Cascades to every campaign_daily_results row. This exists for
// the "linked the wrong campaign ID" case — for a campaign that genuinely ran,
// endCampaignTracking is the right call, because the history is the point.
export async function unlinkCampaign(trackedCampaignId: string, projectId: string, brandId: string) {
  const { supabase } = await requireEditor()

  const { error } = await supabase
    .from('tracked_campaigns')
    .delete()
    .eq('id', trackedCampaignId)

  if (error) throw new Error(`Failed to unlink campaign: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/results')
}

// The repair path. A human corrects a day the agent got wrong; setting
// source='manual' makes the ingest endpoint skip this (campaign, date) on
// every future run, so the correction survives tomorrow's re-pull.
//
// Ratios are RE-DERIVED from the corrected inputs rather than typed
// separately — the whole reason the daily table stores denominators is so a
// human can't leave a hand-edited ROAS disagreeing with its own revenue.
export async function overrideDailyRow(formData: FormData) {
  const { supabase } = await requireEditor()

  const trackedCampaignId = (formData.get('tracked_campaign_id') as string)?.trim()
  const statDate = (formData.get('stat_date') as string)?.trim() ?? ''
  if (!trackedCampaignId || !ISO_DATE.test(statDate)) {
    throw new Error('Campaign and a valid date are required.')
  }

  const spendCents = parseMoneyToCents((formData.get('spend') as string) ?? '')
  const revenueCents = parseMoneyToCents((formData.get('revenue') as string) ?? '')
  if (spendCents === null || revenueCents === null) {
    throw new Error('Spend and revenue must be numbers.')
  }
  if (spendCents < 0 || revenueCents < 0) {
    throw new Error('Spend and revenue cannot be negative.')
  }

  const purchasesRaw = ((formData.get('purchases') as string) ?? '').trim()
  const purchases = purchasesRaw === '' ? 0 : Number(purchasesRaw)
  if (!Number.isFinite(purchases) || purchases < 0) throw new Error('Purchases must be a non-negative number.')

  // Optional fields stay NULL when left blank. A blank box means "I don't
  // know", and writing 0 for it would be inventing a number — the exact thing
  // this whole feature refuses to do.
  const lpViewsRaw = ((formData.get('landing_page_views') as string) ?? '').trim()
  const lpViews = lpViewsRaw === '' ? null : Number(lpViewsRaw)
  if (lpViews !== null && (!Number.isFinite(lpViews) || lpViews < 0)) {
    throw new Error('Landing page views must be a non-negative number.')
  }

  const incrementalRaw = ((formData.get('incremental_revenue') as string) ?? '').trim()
  const incrementalCents = incrementalRaw === '' ? null : parseMoneyToCents(incrementalRaw)
  if (incrementalRaw !== '' && incrementalCents === null) {
    throw new Error('Incremental revenue must be a number, or left blank.')
  }

  const ctrRaw = ((formData.get('unique_outbound_ctr') as string) ?? '').trim()
  const ctr = ctrRaw === '' ? null : Number(ctrRaw)
  if (ctr !== null && (!Number.isFinite(ctr) || ctr < 0)) {
    throw new Error('Outbound CTR must be a non-negative percentage, or left blank.')
  }

  const note = ((formData.get('note') as string) ?? '').trim()

  const { error } = await supabase
    .from('campaign_daily_results')
    .upsert({
      tracked_campaign_id: trackedCampaignId,
      stat_date: statDate,
      spend_cents: spendCents,
      revenue_cents: revenueCents,
      incremental_revenue_cents: incrementalCents,
      purchases: Math.round(purchases),
      landing_page_views: lpViews === null ? null : Math.round(lpViews),
      // Derived, never typed. See the note above.
      roas: safeRoas(revenueCents, spendCents),
      cpa_cents: safeCpa(spendCents, Math.round(purchases)),
      lp_conversion_rate: lpViews === null ? null : safeRate(Math.round(purchases), Math.round(lpViews)),
      unique_outbound_ctr: ctr,
      source: 'manual',
      // The correction's provenance replaces the agent's warnings — the old
      // flags described numbers that no longer exist.
      warnings: note ? [`manually corrected: ${note}`] : ['manually corrected'],
      reported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tracked_campaign_id,stat_date' })

  if (error) throw new Error(`Failed to save the correction: ${error.message}`)

  revalidatePath('/results')
  revalidatePath(`/results/${trackedCampaignId}`)
}

// Cost of delivery for a brand — the input that turns ROAS into contribution
// margin. One value per brand; see 20260805_add_brand_cod.sql for why there
// are two modes.
//
// Clearing the field sets it back to NULL, which makes the UI show CM as an
// em dash. That is deliberate: an unset COD must never be read as 0, which
// would report gross profit as if delivery were free.
export async function setBrandCod(formData: FormData) {
  const { supabase } = await requireEditor()

  const brandId = (formData.get('brand_id') as string)?.trim()
  if (!brandId) throw new Error('Brand is required.')

  const modeRaw = (formData.get('cod_mode') as string)?.trim()
  const mode = modeRaw === 'per_order' ? 'per_order' : 'percent'

  const valueRaw = ((formData.get('cod_value') as string) ?? '').trim()
  let value: number | null = null
  if (valueRaw !== '') {
    value = Number(valueRaw.replace(/[$%,\s]/g, ''))
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Cost of delivery must be a non-negative number, or blank to clear it.')
    }
    // Mirrors brands_cod_value_sane. Caught here too so the user gets a
    // sentence rather than a Postgres constraint name.
    if (mode === 'percent' && value > 100) {
      throw new Error('A cost of delivery above 100% of revenue means every order loses money before ad spend — check the number.')
    }
  }

  const { error } = await supabase
    .from('brands')
    .update({ cod_value: value, cod_mode: mode })
    .eq('id', brandId)

  if (error) throw new Error(`Failed to save cost of delivery: ${error.message}`)

  revalidatePath('/results')
  revalidatePath(`/brands/${brandId}`)
}

// Groups two or more already-tracked entities into one combined Results card
// — the fix for a moment split across sibling ad sets (Mad Viking and WOW
// Sports both run "prospecting" + "retention" as separate ad sets for the
// same moment). Grouping is a display-layer join: the underlying rows are
// untouched, so ending or unlinking one member never touches its sibling.
//
// Server-validated rather than trusting the UI's selection: every id must
// belong to the SAME project. Grouping across projects would combine two
// different moments' numbers under one label, which is exactly the kind of
// silent-wrong-total this feature exists to prevent, not create.
export async function setMomentGroup(formData: FormData) {
  const { supabase } = await requireEditor()

  const ids = formData.getAll('tracked_campaign_id').map(v => String(v)).filter(Boolean)
  const label = ((formData.get('moment_group_label') as string) ?? '').trim()

  if (ids.length < 2) throw new Error('Select at least two tracked campaigns to group.')
  if (!label) throw new Error('A label is required — it is what the combined card is called.')

  const { data: rows, error } = await supabase
    .from('tracked_campaigns')
    .select('id, project_id, moment_group_id')
    .in('id', ids)
  if (error) throw new Error(`Failed to load tracked campaigns: ${error.message}`)
  if (!rows || rows.length !== ids.length) throw new Error('One or more tracked campaigns were not found.')

  const projectIds = new Set(rows.map(r => r.project_id))
  if (projectIds.size > 1) {
    throw new Error('All grouped entries must belong to the same project — grouping across projects would combine two different moments.')
  }

  // If any selected row already belongs to a group, adopt THAT group id rather
  // than minting a new one — this is how a third ad set joins an existing
  // pair. Two DIFFERENT existing groups can't both be right, so refuse rather
  // than guessing which one wins.
  const existingGroups = new Set(rows.map(r => r.moment_group_id).filter((g): g is string => g !== null))
  if (existingGroups.size > 1) {
    throw new Error('These are already in two different groups — ungroup them first, then regroup together.')
  }
  const groupId = existingGroups.size === 1 ? [...existingGroups][0] : crypto.randomUUID()

  const { error: updateErr } = await supabase
    .from('tracked_campaigns')
    .update({ moment_group_id: groupId, moment_group_label: label })
    .in('id', ids)
  if (updateErr) throw new Error(`Failed to group: ${updateErr.message}`)

  const projectId = [...projectIds][0]
  revalidatePath('/results')
  const { data: proj } = await supabase.from('projects').select('brand_id').eq('id', projectId).single()
  if (proj?.brand_id) revalidatePath(`/brands/${proj.brand_id}/projects/${projectId}`)
}

// Removes one tracked campaign from its moment group. If that leaves only one
// member behind, the group is dissolved entirely rather than left as a
// "group of one" — a lone row rendering as a combined card would be a
// distinction with no visible difference, and stale group state is exactly
// the kind of thing that causes confusion months later.
export async function ungroupFromMoment(trackedCampaignId: string) {
  const { supabase } = await requireEditor()

  const { data: row, error } = await supabase
    .from('tracked_campaigns')
    .select('id, project_id, moment_group_id')
    .eq('id', trackedCampaignId)
    .single()
  if (error || !row) throw new Error('Tracked campaign not found.')
  if (!row.moment_group_id) return // already ungrouped — nothing to do

  const { data: siblings, error: sibErr } = await supabase
    .from('tracked_campaigns')
    .select('id')
    .eq('moment_group_id', row.moment_group_id)
    .neq('id', trackedCampaignId)
  if (sibErr) throw new Error(`Failed to check group members: ${sibErr.message}`)

  const { error: clearErr } = await supabase
    .from('tracked_campaigns')
    .update({ moment_group_id: null, moment_group_label: null })
    .eq('id', trackedCampaignId)
  if (clearErr) throw new Error(`Failed to ungroup: ${clearErr.message}`)

  if (siblings && siblings.length === 1) {
    const { error: dissolveErr } = await supabase
      .from('tracked_campaigns')
      .update({ moment_group_id: null, moment_group_label: null })
      .eq('id', siblings[0].id)
    if (dissolveErr) console.error(`[ungroupFromMoment] failed to dissolve trailing group member: ${dissolveErr.message}`)
  }

  const { data: proj } = await supabase.from('projects').select('brand_id').eq('id', row.project_id).single()
  if (proj?.brand_id) revalidatePath(`/brands/${proj.brand_id}/projects/${row.project_id}`)
  revalidatePath('/results')
}

// Hands a day back to the agent: clears the manual lock so the next run
// re-pulls it. The row keeps its numbers until that run lands, so there is no
// window where the day is blank.
export async function releaseDailyRowToAgent(trackedCampaignId: string, statDate: string) {
  const { supabase } = await requireEditor()

  const { error } = await supabase
    .from('campaign_daily_results')
    .update({
      source: 'mcp_agent',
      warnings: ['released back to the agent — will be overwritten on the next run'],
    })
    .eq('tracked_campaign_id', trackedCampaignId)
    .eq('stat_date', statDate)

  if (error) throw new Error(`Failed to release the row: ${error.message}`)

  revalidatePath(`/results/${trackedCampaignId}`)
}

// ---------------------------------------------------------------------------
// LP-scoped results (the per-project Results tab — 20260915_add_lp_results.sql)
// ---------------------------------------------------------------------------
//
// Same three invariants as the campaign actions above, with one addition:
//
//   4. DISCOVERY IS SUGGEST-AND-CONFIRM. The agent proposes ads, the server
//      verifies each destination URL deterministically, and the human on this
//      panel has the last word — excludeAdMatch is a veto that survives
//      re-discovery (the ingest insert ignores duplicates, so an excluded ad
//      is never resurrected).

// Start LP tracking for a project: the opt-in that puts it on the ingest work
// list. One per project (DB unique on project_id).
export async function startLpTracking(formData: FormData) {
  const { supabase, user } = await requireEditor()

  const projectId = (formData.get('project_id') as string)?.trim()
  const brandId = (formData.get('brand_id') as string)?.trim()
  const accountRaw = (formData.get('meta_ad_account_id') as string)?.trim() ?? ''
  const lpUrl = (formData.get('lp_url') as string)?.trim() ?? ''
  const launchedOn = (formData.get('launched_on') as string)?.trim() ?? ''

  if (!projectId || !brandId) throw new Error('Project and brand are required.')

  const adAccountId = normalizeAdAccountId(accountRaw)
  if (!adAccountId) throw new Error('Ad account ID must look like act_1234567890.')
  if (!/^https?:\/\/\S+\.\S+/.test(lpUrl)) {
    throw new Error('Landing page URL must be a full URL (https://…).')
  }
  // OPTIONAL: blank = the nightly agent detects it (the earliest day any
  // matched ad delivered) and the ingest endpoint fills it in. Daily pulls
  // start once the date exists.
  if (launchedOn !== '' && !ISO_DATE.test(launchedOn)) {
    throw new Error('Launch date must be YYYY-MM-DD, or left blank to auto-detect.')
  }
  const today = easternToday()
  if (launchedOn !== '' && launchedOn > today) throw new Error('Launch date cannot be in the future.')

  const { error } = await supabase.from('lp_tracking').insert({
    project_id: projectId,
    brand_id: brandId,
    meta_ad_account_id: adAccountId,
    lp_url: lpUrl,
    launched_on: launchedOn === '' ? null : launchedOn,
    created_by: user.id,
  })
  if (error) {
    if (error.code === '23505') throw new Error('This project already has LP tracking.')
    throw new Error(`Failed to start LP tracking: ${error.message}`)
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

// Sets ended_on: the agent stops pulling new days, every stored day survives.
export async function endLpTracking(lpTrackingId: string, projectId: string, brandId: string) {
  const { supabase } = await requireEditor()
  const { error } = await supabase
    .from('lp_tracking')
    .update({ ended_on: easternToday() })
    .eq('id', lpTrackingId)
  if (error) throw new Error(`Failed to end LP tracking: ${error.message}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function resumeLpTracking(lpTrackingId: string, projectId: string, brandId: string) {
  const { supabase } = await requireEditor()
  const { error } = await supabase
    .from('lp_tracking')
    .update({ ended_on: null })
    .eq('id', lpTrackingId)
  if (error) throw new Error(`Failed to resume LP tracking: ${error.message}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

// DESTROYS the tracking row and (via cascade) every matched ad and every
// stored day. The panel's confirm form says so.
export async function unlinkLpTracking(lpTrackingId: string, projectId: string, brandId: string) {
  const { supabase } = await requireEditor()
  const { error } = await supabase.from('lp_tracking').delete().eq('id', lpTrackingId)
  if (error) throw new Error(`Failed to remove LP tracking: ${error.message}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

// The human veto / un-veto on one matched ad. Excluded ads stop feeding the
// daily aggregate from the NEXT pull onward; days already stored keep the
// numbers they were pulled with (matched_ad_count on each row records the
// coverage that produced it).
export async function setAdMatchStatus(
  matchId: string,
  status: 'included' | 'excluded',
  projectId: string,
  brandId: string,
) {
  const { supabase, user } = await requireEditor()
  const { error } = await supabase
    .from('lp_ad_matches')
    .update({ status, decided_by: user.id, decided_at: new Date().toISOString() })
    .eq('id', matchId)
  if (error) throw new Error(`Failed to update the ad match: ${error.message}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

// The manual fallback: an ad the discovery missed (different domain, redirect,
// dynamic URL). Added by Meta ad ID; names are optional context. If the ad is
// already on file (e.g. previously excluded), this re-includes it rather than
// failing — adding an ad you can see in the list IS the un-exclude gesture.
export async function addManualAdMatch(formData: FormData) {
  const { supabase, user } = await requireEditor()

  const lpTrackingId = (formData.get('lp_tracking_id') as string)?.trim()
  const projectId = (formData.get('project_id') as string)?.trim()
  const brandId = (formData.get('brand_id') as string)?.trim()
  const adId = (formData.get('meta_ad_id') as string)?.trim() ?? ''
  const adName = (formData.get('ad_name') as string)?.trim() ?? ''

  if (!lpTrackingId || !projectId || !brandId) throw new Error('Missing tracking context.')
  if (!/^\d+$/.test(adId)) throw new Error('Ad ID must be the numeric Meta ad ID.')

  const { data: existing, error: readErr } = await supabase
    .from('lp_ad_matches')
    .select('id')
    .eq('lp_tracking_id', lpTrackingId)
    .eq('meta_ad_id', adId)
    .maybeSingle()
  if (readErr) throw new Error(`Failed to check existing matches: ${readErr.message}`)

  if (existing) {
    const { error } = await supabase
      .from('lp_ad_matches')
      .update({ status: 'included', decided_by: user.id, decided_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw new Error(`Failed to re-include the ad: ${error.message}`)
  } else {
    const { error } = await supabase.from('lp_ad_matches').insert({
      lp_tracking_id: lpTrackingId,
      meta_ad_id: adId,
      ad_name: adName === '' ? null : adName,
      status: 'included',
      source: 'manual',
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    if (error) throw new Error(`Failed to add the ad: ${error.message}`)
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

// The "push to client" flag. True = the client review link (/review/[token])
// renders the results section. Internal-first, exactly like creative
// client_visible: nothing on the client link changes until a human presses
// the button.
export async function setResultsClientVisible(projectId: string, brandId: string, visible: boolean) {
  const { supabase } = await requireEditor()
  const { error } = await supabase
    .from('projects')
    .update({ results_client_visible: visible })
    .eq('id', projectId)
  if (error) throw new Error(`Failed to update client visibility: ${error.message}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}
