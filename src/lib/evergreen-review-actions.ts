'use server'

// Evergreen Ads — the anonymous client review link (/review/evergreen/<token>).
//
// Same model as the creative review link: the share_token IS the
// authorization, and writes go through the service role because the anon
// client has no policy on these tables. Every action re-checks that the video
// or comment belongs to the token's ad.

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { isReviewToken, type EvergreenVideoStatus } from '@/lib/evergreen'

type Result = { ok: true } | { ok: false; error: string }

const NAME_LIMIT = 120
const COMMENT_LIMIT = 4000
// The client may not write a status the team did not offer them.
const CLIENT_STATUSES: EvergreenVideoStatus[] = ['pending', 'approved', 'needs_revision', 'rejected']

async function adForToken(token: string) {
  if (!isReviewToken(token)) return null
  const service = createServiceClient()
  const { data } = await service.from('evergreen_ads').select('id, is_archived').eq('share_token', token).maybeSingle()
  if (!data || data.is_archived) return null
  return { service, adId: data.id as string }
}

function refresh(token: string, adId: string) {
  revalidatePath(`/review/evergreen/${token}`)
  revalidatePath(`/evergreen-ads/${adId}`)
  revalidatePath('/evergreen-ads')
}

export async function addEvergreenClientComment(
  token: string,
  videoId: string | null,
  authorName: string,
  content: string,
): Promise<Result> {
  const found = await adForToken(token)
  if (!found) return { ok: false, error: 'This review link is no longer valid.' }
  const { service, adId } = found
  const text = (content ?? '').trim().slice(0, COMMENT_LIMIT)
  if (!text) return { ok: false, error: 'Write a comment first.' }

  if (videoId) {
    const { data: v } = await service.from('evergreen_ad_videos')
      .select('id').eq('id', videoId).eq('ad_id', adId).eq('client_visible', true).maybeSingle()
    if (!v) return { ok: false, error: 'That video is no longer on this link.' }
  }

  const { error } = await service.from('evergreen_ad_comments').insert({
    ad_id: adId,
    video_id: videoId,
    author_name: (authorName ?? '').trim().slice(0, NAME_LIMIT) || 'Anonymous',
    content: text,
    // Comments from the review link are always client-facing.
    audience: 'client',
  })
  if (error) return { ok: false, error: 'Could not post your comment. Please try again.' }

  // Same rule as the creative review link: a comment on a video means it
  // needs changes. Never downgrades a rejection.
  if (videoId) {
    await service.from('evergreen_ad_videos')
      .update({ status: 'needs_revision', updated_at: new Date().toISOString() })
      .eq('id', videoId).eq('ad_id', adId).neq('status', 'rejected')
    await service.from('evergreen_ads').update({ client_approved: false, client_approved_at: null }).eq('id', adId)
  }

  refresh(token, adId)
  return { ok: true }
}

export async function setEvergreenClientVideoStatus(
  token: string,
  videoId: string,
  status: EvergreenVideoStatus,
): Promise<Result> {
  if (!CLIENT_STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' }
  const found = await adForToken(token)
  if (!found) return { ok: false, error: 'This review link is no longer valid.' }
  const { service, adId } = found

  const { data, error } = await service.from('evergreen_ad_videos')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', videoId).eq('ad_id', adId).eq('client_visible', true)
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'Could not save. Please try again.' }

  // A whole-ad approval no longer stands once any video is sent back.
  if (status !== 'approved') {
    await service.from('evergreen_ads').update({ client_approved: false, client_approved_at: null }).eq('id', adId)
  }
  refresh(token, adId)
  return { ok: true }
}

/** "Approve all": every video on the link is approved, and so is the ad. */
export async function approveEvergreenAd(token: string): Promise<Result> {
  const found = await adForToken(token)
  if (!found) return { ok: false, error: 'This review link is no longer valid.' }
  const { service, adId } = found
  const now = new Date().toISOString()

  const { error: vErr } = await service.from('evergreen_ad_videos')
    .update({ status: 'approved', updated_at: now })
    .eq('ad_id', adId).eq('client_visible', true)
  if (vErr) return { ok: false, error: 'Could not approve. Please try again.' }
  const { error } = await service.from('evergreen_ads')
    .update({ client_approved: true, client_approved_at: now, updated_at: now }).eq('id', adId)
  if (error) return { ok: false, error: 'Could not approve. Please try again.' }

  refresh(token, adId)
  return { ok: true }
}
