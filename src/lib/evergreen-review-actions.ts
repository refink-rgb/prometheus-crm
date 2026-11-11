'use server'

// Evergreen Ads — the anonymous client review link (/review/evergreen/<token>).
//
// Same model as the creative review link: the share_token IS the
// authorization, and writes go through the service role because the anon
// client has no policy on these tables. Every action re-checks that the static,
// video or comment belongs to the token's ad.

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { createNotifications } from '@/lib/notifications'
import { isPin, isReviewStatus, isReviewToken, isUuid, toCreative, type EvergreenReviewStatus, type Pin } from '@/lib/evergreen'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }
type Ad = { db: SupabaseClient; id: string; name: string; brandId: string; brandName: string }

const NAME_LIMIT = 120
const COMMENT_LIMIT = 4000
const CLOSED = { ok: false as const, error: 'This review link is no longer valid.' }

async function adForToken(token: string): Promise<Ad | null> {
  if (!isReviewToken(token)) return null
  const db = createServiceClient()
  const { data } = await db.from('evergreen_ads').select('id, name, brand_id, is_archived, brands(name)').eq('share_token', token).maybeSingle()
  if (!data || data.is_archived) return null
  return { db, id: data.id as string, name: data.name as string, brandId: data.brand_id as string, brandName: (data.brands as unknown as { name?: string } | null)?.name ?? 'The client' }
}

function refresh(token: string, adId: string) {
  revalidatePath(`/review/evergreen/${token}`)
  revalidatePath(`/evergreen-ads/${adId}`)
  revalidatePath('/evergreen-ads')
}

async function clearApproval(ad: Ad) {
  await ad.db.from('evergreen_ads').update({ client_approved: false, client_approved_at: null }).eq('id', ad.id)
}

/** Tells the people building the ad. Best-effort: never fails the client's action. */
async function notifyPeople(ad: Ad, author: string, title: string, body: string) {
  const { data, error } = await ad.db.from('evergreen_ad_assignees').select('profile_id').eq('ad_id', ad.id)
  if (error || !data?.length) return
  await createNotifications(data.map(r => ({
    recipient_id: r.profile_id as string, actor_label: author, type: 'client_feedback' as const, brand_id: ad.brandId,
    title, body: body.slice(0, 140), link: `/evergreen-ads/${ad.id}`,
  })))
}

/** A static or video that is on this link. */
async function visibleCreative(ad: Ad, creativeId: string) {
  if (!isUuid(creativeId)) return null
  const { data } = await ad.db.from('evergreen_ad_videos').select('*').eq('id', creativeId).eq('ad_id', ad.id).eq('client_visible', true).maybeSingle()
  return data ? toCreative(data) : null
}

/**
 * A client comment, on one static or video (creativeId) or on the ad as a whole
 * (null). On a static it may carry a pin: where on the image the note points.
 */
export async function addEvergreenClientComment(
  token: string,
  creativeId: string | null,
  authorName: string,
  content: string,
  pin?: Pin | null,
): Promise<Result<{ id: string }>> {
  const ad = await adForToken(token)
  if (!ad) return CLOSED
  const text = (content ?? '').trim().slice(0, COMMENT_LIMIT)
  if (!text) return { ok: false, error: 'Write a comment first.' }
  if (pin && !isPin(pin)) return { ok: false, error: 'Invalid pin.' }

  const creative = creativeId ? await visibleCreative(ad, creativeId) : null
  if (creativeId && !creative) return { ok: false, error: 'That one is no longer on this link.' }
  if (pin && creative?.media_type !== 'image') return { ok: false, error: 'Pins go on statics only.' }

  const author = (authorName ?? '').trim().slice(0, NAME_LIMIT) || 'Anonymous'
  const { data, error } = await ad.db.from('evergreen_ad_comments').insert({
    ad_id: ad.id,
    video_id: creative?.id ?? null,
    author_name: author,
    content: text,
    // Comments from the review link are always client-facing.
    audience: 'client',
    // Only sent with a pin, so plain comments work before the 20261110 migration.
    ...(pin ? { pin_x: pin.x, pin_y: pin.y } : {}),
  }).select('id').single()
  if (error || !data) return { ok: false, error: 'Could not post your comment. Please try again.' }

  // Same rule as the creative review link: a comment on a static or video means
  // it needs changes. Never downgrades a rejection.
  if (creative) {
    await ad.db.from('evergreen_ad_videos')
      .update({ status: 'needs_revision', updated_at: new Date().toISOString() })
      .eq('id', creative.id).eq('ad_id', ad.id).neq('status', 'rejected')
    await clearApproval(ad)
  }

  await notifyPeople(ad, author, `${ad.brandName} commented on ${ad.name}`, creative ? `${creative.name}: ${text}` : text)
  refresh(token, ad.id)
  return { ok: true, id: data.id as string }
}

export async function setEvergreenClientStatus(token: string, creativeId: string, status: EvergreenReviewStatus): Promise<Result> {
  if (!isReviewStatus(status)) return { ok: false, error: 'Unknown status.' }
  const ad = await adForToken(token)
  if (!ad) return CLOSED
  if (!isUuid(creativeId)) return { ok: false, error: 'Could not save. Please try again.' }

  const { data, error } = await ad.db.from('evergreen_ad_videos')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', creativeId).eq('ad_id', ad.id).eq('client_visible', true)
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'Could not save. Please try again.' }

  // A whole-ad approval no longer stands once anything is sent back.
  if (status !== 'approved') await clearApproval(ad)
  refresh(token, ad.id)
  return { ok: true }
}

/** "Approve all": everything on the link is approved, and so is the ad. */
export async function approveEvergreenAd(token: string, authorName?: string): Promise<Result> {
  const ad = await adForToken(token)
  if (!ad) return CLOSED
  const now = new Date().toISOString()

  const { error: cErr } = await ad.db.from('evergreen_ad_videos')
    .update({ status: 'approved', updated_at: now })
    .eq('ad_id', ad.id).eq('client_visible', true)
  if (cErr) return { ok: false, error: 'Could not approve. Please try again.' }
  const { error } = await ad.db.from('evergreen_ads')
    .update({ client_approved: true, client_approved_at: now, updated_at: now }).eq('id', ad.id)
  if (error) return { ok: false, error: 'Could not approve. Please try again.' }

  const author = (authorName ?? '').trim().slice(0, NAME_LIMIT) || ad.brandName
  await notifyPeople(ad, author, `${ad.brandName} approved ${ad.name}`, 'Everything on the review link is approved.')
  refresh(token, ad.id)
  return { ok: true }
}
