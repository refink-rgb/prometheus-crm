'use server'

import { revalidatePath } from 'next/cache'

// Revalidation rule of thumb: only invalidate '/' (the dashboard) when the
// mutation changes something the dashboard actually renders — the pipeline
// table reads name/due_date/is_complete/lp_stage/creatives_stage/lp_approved/
// creatives_approved, and the KPI strip reads brand count / MRR. For anything
// else, revalidate only the specific brand/project/pipeline paths.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Stage } from '@/lib/types'
import {
  ensureDeleteSubfolder,
  extractDriveFolderId,
  hasDriveServiceAccount,
  listDriveFolder,
  moveDriveFile,
} from '@/lib/drive'

export async function createBrand(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const name = formData.get('name') as string
  const raw = (formData.get('website') as string).trim()
  const website = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const retainerRaw = (formData.get('monthly_retainer') as string)?.trim()
  const monthly_retainer = retainerRaw ? parseFloat(retainerRaw) : null
  const start_date = (formData.get('start_date') as string) || null
  const profit_engineer = (formData.get('profit_engineer') as string)?.trim() || null

  // Auto-assign next client number
  const { data: maxRow } = await supabase
    .from('brands')
    .select('client_number')
    .order('client_number', { ascending: false })
    .limit(1)
    .single()
  const client_number = ((maxRow?.client_number as number | null) ?? 0) + 1

  const { data, error } = await supabase
    .from('brands')
    .insert({
      name,
      website,
      created_by: user?.id ?? null,
      growth_strategist: user?.email ?? null,
      monthly_retainer,
      start_date,
      profit_engineer,
      pipeline_status: 'intro_contact',
      is_active: false,
      client_number,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  redirect(`/brands/${data.id}`)
}

// Returns the redirect path so the client component can navigate itself.
// Never calls redirect() here — that breaks inside client-component try/catch.
export async function createProject(formData: FormData): Promise<{ redirect: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const brandId = formData.get('brand_id') as string
  const imageUrls = JSON.parse(formData.get('image_urls') as string) as Array<{ path: string; url: string }>

  const str = (key: string) => (formData.get(key) as string)?.trim() || null

  // Handle journey: use existing or create new
  let journey_id = str('journey_id')
  const newJourneyName = str('new_journey_name')

  if (!journey_id && newJourneyName) {
    const { data: newJourney, error: jErr } = await supabase
      .from('journeys')
      .insert({ brand_id: brandId, name: newJourneyName })
      .select()
      .single()
    if (jErr) throw new Error(jErr.message)
    journey_id = newJourney.id
  }

  const momentRaw = formData.get('marketing_moment') as string
  const marketing_moment = momentRaw === '1' ? 1 : momentRaw === '2' ? 2 : null

  // JSON-encoded arrays for headline/subcopy/eyebrow banks. Empty entries dropped
  // server-side so a bank with only 2 filled slots doesn't persist 3 empty strings.
  const jsonArr = (key: string): string[] | null => {
    const raw = formData.get(key) as string | null
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      const cleaned = parsed.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
      return cleaned.length > 0 ? cleaned : null
    } catch { return null }
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      brand_id: brandId,
      name: formData.get('name') as string,
      due_date: formData.get('due_date') as string,
      stage_brief_due_date:           str('stage_brief_due_date'),
      stage_in_progress_due_date:     str('stage_in_progress_due_date'),
      stage_internal_review_due_date: str('stage_internal_review_due_date'),
      stage_client_review_due_date:   str('stage_client_review_due_date'),
      offer_description: str('offer_description'),
      offer: str('offer'),
      headline: str('headline'),
      body_copy: str('body_copy'),
      supporting_message: str('supporting_message'),
      cta: str('cta'),
      journey_id,
      marketing_moment,
      page_type: str('page_type'),
      product_featured: str('product_featured'),
      product_description: str('product_description'),
      retail_price: str('retail_price'),
      offer_dynamics_type: str('offer_dynamics_type'),
      competitor_reference: str('competitor_reference'),
      client_ad_inspiration: str('client_ad_inspiration'),
      ad_copy_primary_text: str('ad_copy_primary_text'),
      ad_copy_description: str('ad_copy_description'),
      ad_copy_url: str('ad_copy_url'),
      ad_headlines: jsonArr('ad_headlines'),
      ad_subcopies: jsonArr('ad_subcopies'),
      ad_eyebrows: jsonArr('ad_eyebrows'),
      product_images_link: str('product_images_link'),
      assigned_designer: str('assigned_designer'),
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  if (imageUrls.length > 0) {
    const { error: imgErr } = await supabase.from('project_images').insert(
      imageUrls.map(({ path, url }) => ({
        project_id: data.id,
        storage_path: path,
        storage_url: url,
      }))
    )
    if (imgErr) throw new Error(`Failed to attach project images: ${imgErr.message}`)
  }

  revalidatePath(`/brands/${brandId}`)
  return { redirect: `/brands/${brandId}/projects/${data.id}` }
}

export async function updateProjectStage(
  projectId: string,
  brandId: string,
  track: 'lp_stage' | 'creatives_stage',
  stage: Stage
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase
    .from('projects')
    .update({ [track]: stage })
    .eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

// Combined stage update — used by the pipeline kanban drag-drop, which always
// moves both LP and Creatives to the same column. One UPDATE + one server call
// instead of two, so the optimistic UI settles faster.
export async function updateProjectStagesBoth(
  projectId: string,
  brandId: string,
  stage: Stage
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase
    .from('projects')
    .update({ lp_stage: stage, creatives_stage: stage })
    .eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
  revalidatePath('/pipeline')
}

export async function updateProjectDeliverable(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const projectId = formData.get('project_id') as string
  const brandId = formData.get('brand_id') as string

  await supabase
    .from('projects')
    .update({
      lp_url: formData.get('lp_url') as string || null,
      creatives_notes: formData.get('creatives_notes') as string || null,
      shopify_coupon_code: (formData.get('shopify_coupon_code') as string)?.trim() || null,
      motion_link: (formData.get('motion_link') as string)?.trim() || null,
    })
    .eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function toggleProjectRevisions(projectId: string, brandId: string, value: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase
    .from('projects')
    .update({ needs_revisions: value })
    .eq('id', projectId)

  // needs_revisions is not shown on the dashboard — skip '/'.
  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function markProjectComplete(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase
    .from('projects')
    .update({ is_complete: true, lp_stage: 'done', creatives_stage: 'done' })
    .eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

export async function updateBrandDetails(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const brandId = formData.get('brand_id') as string
  const retainerRaw = (formData.get('monthly_retainer') as string)?.trim()
  const monthly_retainer = retainerRaw ? parseFloat(retainerRaw) : null
  const start_date = (formData.get('start_date') as string) || null
  const growth_strategist = (formData.get('growth_strategist') as string)?.trim() || null
  const clientStatus = formData.get('client_status') as string
  const is_trial = clientStatus === 'trial'
  const is_active = clientStatus === 'active' || clientStatus === 'trial'
  const profit_engineer = (formData.get('profit_engineer') as string)?.trim() || null
  const pipeline_status = (formData.get('pipeline_status') as string) || 'active'
  const brand_notes = (formData.get('brand_notes') as string)?.trim() || null
  const onboarding_transcript = (formData.get('onboarding_transcript') as string)?.trim() || null

  const core = { monthly_retainer, start_date, growth_strategist, is_active, is_trial, profit_engineer, pipeline_status, brand_notes }

  // Try with onboarding_transcript. If the column doesn't exist yet (migration
  // 20260701_add_onboarding_transcript.sql not applied), fall back to a save
  // without it so the rest of the account details still persist.
  const { error } = await supabase
    .from('brands')
    .update({ ...core, onboarding_transcript })
    .eq('id', brandId)

  if (error) {
    const missingColumn = error.code === '42703' || /onboarding_transcript/.test(error.message ?? '')
    if (!missingColumn) throw new Error(error.message)
    await supabase.from('brands').update(core).eq('id', brandId)
  }

  revalidatePath(`/brands/${brandId}`)
}

export async function updateBrandPipelineStatus(
  brandId: string,
  newStatus: 'intro_contact' | 'discovery_call' | 'offer_prep' | 'active',
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase
    .from('brands')
    .update({ pipeline_status: newStatus })
    .eq('id', brandId)

  // Dashboard doesn't render pipeline_status; the financials page does.
  revalidatePath('/pipeline')
  revalidatePath('/financials')
  revalidatePath(`/brands/${brandId}`)
}

export async function generateShareToken(projectId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { randomBytes } = await import('crypto')
  const token = randomBytes(20).toString('hex')

  await supabase
    .from('projects')
    .update({ share_token: token })
    .eq('id', projectId)

  return token
}

export async function addProjectComment(
  token: string,
  authorName: string,
  content: string,
  extras?: {
    track?: 'lp' | 'image' | 'general' | 'note'
    asset_id?: string
    pin_x?: number
    pin_y?: number
    section_tag?: string
    attachment_urls?: string[]
  }
) {
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('share_token', token)
    .single()

  if (!project) throw new Error('Invalid review link.')

  const cleanedAttachments = (extras?.attachment_urls ?? []).filter(u => typeof u === 'string' && u.length > 0)

  await supabase
    .from('project_comments')
    .insert({
      project_id: project.id,
      author_name: authorName.trim(),
      content: content.trim(),
      track: extras?.track ?? 'general',
      asset_id: extras?.asset_id ?? null,
      pin_x: extras?.pin_x ?? null,
      pin_y: extras?.pin_y ?? null,
      section_tag: extras?.section_tag ?? null,
      attachment_urls: cleanedAttachments.length > 0 ? cleanedAttachments : null,
      // Comments from the public review link are always client-facing.
      audience: 'client',
    })

  revalidatePath(`/review/${token}`)
}

// Authed-only: delete a comment from the client review page. Gated by the same
// ALLOWED_EDITORS allowlist used everywhere else — anonymous client viewers
// can't trigger this even if they discover the action.
export async function deleteProjectComment(commentId: string, token: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authorized.')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { data: comment } = await supabase
    .from('project_comments')
    .select('project_id')
    .eq('id', commentId)
    .single()
  if (!comment) throw new Error('Comment not found.')

  const { data: project } = await supabase
    .from('projects')
    .select('id, brand_id')
    .eq('share_token', token)
    .single()
  if (!project || project.id !== comment.project_id) {
    throw new Error('Comment does not belong to this review link.')
  }

  const { error } = await supabase
    .from('project_comments')
    .delete()
    .eq('id', commentId)
  if (error) throw new Error(error.message)

  revalidatePath(`/review/${token}`)
  revalidatePath(`/brands/${project.brand_id}/projects/${project.id}`)
  revalidatePath(`/brands/${project.brand_id}/projects/${project.id}/internal-review`)
}

export async function syncDriveImages(projectId: string, brandId: string, folderUrl: string): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  // Auth is now handled inside listDriveFolder (prefers SA, falls back to API key).
  const folderId = extractDriveFolderId(folderUrl)

  // First, save the folder URL on the project
  await supabase
    .from('projects')
    .update({ drive_folder_url: folderUrl })
    .eq('id', projectId)

  const imageFiles = await listDriveFolder(folderId)

  const driveFileIds = imageFiles.map(f => f.id)

  // Soft-hide assets no longer in the root Drive folder. We DON'T hard-delete:
  // (1) the file may have been moved into Delete/ via the Drive helper here,
  // (2) preserving the row keeps comments, revisions, and publish history intact.
  const { data: existing } = await supabase
    .from('creative_assets')
    .select('id, drive_file_id')
    .eq('project_id', projectId)

  const toHide = (existing ?? []).filter(a => !driveFileIds.includes(a.drive_file_id))
  if (toHide.length > 0) {
    await supabase
      .from('creative_assets')
      .update({ is_hidden: true })
      .in('id', toHide.map(a => a.id))
  }

  if (imageFiles.length === 0) {
    revalidatePath(`/brands/${brandId}/projects/${projectId}`)
    return 0
  }

  // Upsert assets — preserve is_hidden for existing entries
  const { error } = await supabase
    .from('creative_assets')
    .upsert(
      imageFiles.map((f, i) => ({
        project_id: projectId,
        drive_file_id: f.id,
        name: f.name,
        thumbnail_url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w600`,
        sort_order: i,
      })),
      { onConflict: 'project_id,drive_file_id', ignoreDuplicates: false }
    )

  if (error) throw new Error(error.message)

  // New creatives start INTERNAL-ONLY — they only reach the client once
  // explicitly published. (Only touch genuinely new ones, so re-syncing never
  // un-publishes anything already live with the client.)
  const existingIds = new Set((existing ?? []).map(a => a.drive_file_id))
  const newIds = driveFileIds.filter(id => !existingIds.has(id))
  if (newIds.length > 0) {
    await supabase
      .from('creative_assets')
      .update({ client_visible: false })
      .eq('project_id', projectId)
      .in('drive_file_id', newIds)
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return imageFiles.length
}

function describePosition(x: number, y: number): string {
  const h = x < 33 ? 'left' : x < 66 ? 'center' : 'right'
  const v = y < 25 ? 'top' : y < 75 ? 'middle' : 'bottom'
  return `${v}-${h}`
}

// A comment is actionable if it reads like a change request, not a pure
// question or note. (v1 heuristic — can be upgraded to an LLM classifier.)
function isActionableComment(content: string | null): boolean {
  const t = (content || '').trim()
  if (!t) return false
  const isQuestion = t.endsWith('?') &&
    /^(is|are|was|were|do|does|did|can|could|should|would|will|why|what|how|when|where|who|which)\b/i.test(t)
  return !isQuestion
}

function buildRevisionPrompt(comments: Array<{
  author_name: string; content: string; pin_x: number | null; pin_y: number | null
}>): string {
  const pinned = comments.filter(c => c.pin_x != null)
  const general = comments.filter(c => c.pin_x == null)
  const lines = [
    'Edit this marketing creative image. Apply the following reviewer-requested changes while maintaining the overall design style, brand colors, layout, and composition.',
    '',
    'REQUESTED CHANGES:',
  ]
  pinned.forEach((c, i) => {
    const pos = describePosition(c.pin_x!, c.pin_y!)
    lines.push(`${i + 1}. [${pos} area — from ${c.author_name}]: ${c.content}`)
  })
  general.forEach((c, i) => {
    lines.push(`${pinned.length + i + 1}. [General — from ${c.author_name}]: ${c.content}`)
  })
  lines.push('', 'Maintain brand identity and only make the specific changes listed above.')
  return lines.join('\n')
}

export async function applyAiEdits(
  assetId: string,
  projectId: string,
  brandId: string,
  quality: 'low' | 'medium' | 'high' = 'low'
): Promise<{ revisionUrl: string; prompt: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not set — add it in Vercel → Settings → Environment Variables.')

  // Fetch asset
  const { data: asset } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('id', assetId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  // Fetch comments for this asset
  const { data: comments } = await supabase
    .from('project_comments')
    .select('author_name, content, pin_x, pin_y')
    .eq('asset_id', assetId)
    .order('created_at')

  if (!comments || comments.length === 0) {
    throw new Error('No comments found for this image. Add reviewer feedback before generating a revision.')
  }

  // Only feed actionable change requests to the model — skip pure questions /
  // notes (e.g. "Is this a real review?") so they don't corrupt the revision.
  const actionable = comments.filter(c => isActionableComment(c.content))
  if (actionable.length === 0) {
    throw new Error('No actionable edit requests found — the comments read like questions or notes, not change requests.')
  }

  const prompt = buildRevisionPrompt(actionable)

  // Download image from Drive
  const driveUrl = `https://drive.google.com/uc?export=download&id=${asset.drive_file_id}`
  const imageRes = await fetch(driveUrl, { redirect: 'follow' })
  if (!imageRes.ok) throw new Error(`Failed to download image from Drive (HTTP ${imageRes.status}). Make sure the file is publicly shared.`)

  const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

  // Build the edit request
  const { default: OpenAI, toFile } = await import('openai')
  const openai = new OpenAI({ apiKey: openaiKey })
  const imageFile = await toFile(imageBuffer, 'creative.jpg', { type: 'image/jpeg' })

  const response = await (openai.images as unknown as {
    edit: (params: unknown) => Promise<{ data: Array<{ b64_json?: string }> }>
  }).edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt,
    n: 1,
    size: 'auto',
    quality,
  })

  const b64 = response.data[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data. Try again.')

  // Upload revision to Supabase storage
  const revisionBuffer = Buffer.from(b64, 'base64')
  const revisionPath = `revisions/${assetId}-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage
    .from('project-images')
    .upload(revisionPath, revisionBuffer, { contentType: 'image/png', upsert: true })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(revisionPath)

  // Persist revision on asset
  await supabase
    .from('creative_assets')
    .update({ revision_url: publicUrl, revision_prompt: prompt, revision_created_at: new Date().toISOString() })
    .eq('id', assetId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return { revisionUrl: publicUrl, prompt }
}

// Team action (authenticated): publish the CURRENT revision to the client.
// Freezes published_url to whatever revision exists now — so later edits (which
// update revision_url) don't reach the client until you publish again.
export async function approveAndPublishRevision(assetId: string, projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { data: asset } = await supabase
    .from('creative_assets')
    .select('revision_url')
    .eq('id', assetId)
    .single()

  // Publish to client = make it client-visible + freeze the published image to
  // the current revision (or the original, if there's no revision — publish as-is).
  // Do NOT touch status: "approved" is the CLIENT's action on the review link.
  const update: { client_visible: boolean; published_url?: string } = {
    client_visible: true,
  }
  if (asset?.revision_url) update.published_url = asset.revision_url

  const { error } = await supabase
    .from('creative_assets')
    .update(update)
    .eq('id', assetId)
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/review`, 'layout')
}

/**
 * Bulk "Publish to client" — same semantics as approveAndPublishRevision but for
 * many assets at once. For each: client_visible=true and published_url frozen to
 * its current revision (or left as-is/original if no revision). Never touches
 * `status` — client approval stays the client's action. Returns the count published.
 *
 * If `assetIds` is omitted, publishes every not-yet-visible asset on the project
 * (the "publish all internal" path).
 */
export async function publishAssets(
  projectId: string,
  brandId: string,
  assetIds?: string[]
): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  let query = supabase
    .from('creative_assets')
    .select('id, revision_url, client_visible, published_url')
    .eq('project_id', projectId)
    .eq('is_hidden', false)
  if (assetIds && assetIds.length > 0) {
    query = query.in('id', assetIds)
  } else {
    // "Publish all internal": only those not already live on the client.
    query = query.eq('client_visible', false)
  }

  const { data: rows, error: selErr } = await query
  if (selErr) throw new Error(selErr.message)

  // Two update shapes: rows without a revision_url just flip client_visible;
  // rows with a revision_url also copy it into published_url. Batch the first
  // group into one query; parallelize the second because published_url differs
  // per row.
  const rowsList = rows ?? []
  const plainIds = rowsList.filter(r => !r.revision_url).map(r => r.id)
  const withRevision = rowsList.filter(r => r.revision_url)

  let published = 0

  if (plainIds.length > 0) {
    const { error } = await supabase
      .from('creative_assets')
      .update({ client_visible: true })
      .in('id', plainIds)
    if (error) console.error('[publishAssets] batch update failed:', error.message)
    else published += plainIds.length
  }

  if (withRevision.length > 0) {
    const results = await Promise.all(withRevision.map(row =>
      supabase
        .from('creative_assets')
        .update({ client_visible: true, published_url: row.revision_url })
        .eq('id', row.id)
        .then(({ error }) => ({ id: row.id, error }))
    ))
    for (const r of results) {
      if (r.error) console.error(`[publishAssets] failed for ${r.id}:`, r.error.message)
      else published += 1
    }
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath(`/review`, 'layout')
  return published
}

// Internal helper: move a single asset's Drive file into the project's Delete
// subfolder and set is_hidden=true. Does NOT do auth — callers gate access.
// Throws on Drive failure; callers decide whether to swallow that error.
// Callers batching over many assets should pass `driveFolderUrl` to avoid
// re-fetching the project row per asset.
async function _archiveAssetCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
  projectId: string,
  driveFolderUrl?: string
): Promise<void> {
  const { data: asset } = await supabase
    .from('creative_assets')
    .select('drive_file_id')
    .eq('id', assetId)
    .eq('project_id', projectId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  let folderUrl = driveFolderUrl
  if (!folderUrl) {
    const { data: project } = await supabase
      .from('projects')
      .select('drive_folder_url')
      .eq('id', projectId)
      .single()
    folderUrl = project?.drive_folder_url
  }
  if (!folderUrl) {
    throw new Error('Project has no Drive folder configured — cannot move file to Delete.')
  }

  const parentFolderId = extractDriveFolderId(folderUrl)
  const deleteFolderId = await ensureDeleteSubfolder(parentFolderId)
  await moveDriveFile(asset.drive_file_id, parentFolderId, deleteFolderId)

  await supabase
    .from('creative_assets')
    .update({ is_hidden: true })
    .eq('id', assetId)
}

// Internal helper: restore an asset from Delete back to the project's root
// Drive folder, and set is_hidden=false.
async function _restoreAssetCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
  projectId: string
): Promise<void> {
  const { data: asset } = await supabase
    .from('creative_assets')
    .select('drive_file_id')
    .eq('id', assetId)
    .eq('project_id', projectId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  const { data: project } = await supabase
    .from('projects')
    .select('drive_folder_url')
    .eq('id', projectId)
    .single()
  if (!project?.drive_folder_url) {
    throw new Error('Project has no Drive folder configured — cannot restore file.')
  }

  const parentFolderId = extractDriveFolderId(project.drive_folder_url)
  const deleteFolderId = await ensureDeleteSubfolder(parentFolderId)
  // Reverse the move: from Delete → back to root.
  await moveDriveFile(asset.drive_file_id, deleteFolderId, parentFolderId)

  await supabase
    .from('creative_assets')
    .update({ is_hidden: false })
    .eq('id', assetId)
}

/**
 * Move a creative's Drive file into the project's "Delete" subfolder and
 * soft-hide it in the CRM. Authed; gated by canEdit.
 */
export async function archiveAssetToDeleteFolder(
  assetId: string,
  projectId: string,
  brandId: string
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await _archiveAssetCore(supabase, assetId, projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath('/review', 'layout')
}

/**
 * Batch-purge stale assets (is_hidden=true OR status='rejected') by moving
 * each to the project's Delete subfolder. Idempotent: already-moved files
 * are skipped. Authed.
 *
 * If `assetIds` is provided, only those IDs are touched. Otherwise every
 * stale asset on the project is purged.
 *
 * Returns the count of assets the action processed (i.e. for which the
 * Drive move + hide succeeded). Failed assets are logged but do not abort
 * the batch.
 */
export async function purgeStaleAssets(
  projectId: string,
  brandId: string,
  assetIds?: string[]
): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  let query = supabase
    .from('creative_assets')
    .select('id, is_hidden, status, internal_status')
    .eq('project_id', projectId)

  if (assetIds && assetIds.length > 0) {
    query = query.in('id', assetIds)
  }

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  const targets = (rows ?? []).filter(a =>
    assetIds && assetIds.length > 0 ? true : a.is_hidden || a.status === 'rejected' || a.internal_status === 'rejected'
  )

  // Fetch the project's drive folder once and pass it into each archive call,
  // instead of re-fetching per asset (was 2N+1 queries).
  let driveFolderUrl: string | undefined
  if (targets.length > 0) {
    const { data: project } = await supabase
      .from('projects')
      .select('drive_folder_url')
      .eq('id', projectId)
      .single()
    driveFolderUrl = project?.drive_folder_url ?? undefined
    if (!driveFolderUrl) {
      throw new Error('Project has no Drive folder configured — cannot move files to Delete.')
    }
  }

  let purged = 0
  for (const row of targets) {
    try {
      await _archiveAssetCore(supabase, row.id, projectId, driveFolderUrl)
      purged += 1
    } catch (err) {
      console.error(`[purgeStaleAssets] failed for asset ${row.id}:`, err)
    }
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  revalidatePath('/review', 'layout')
  return purged
}

// Called from public review page via share token
export async function updateAssetStatus(token: string, assetId: string, status: 'pending' | 'approved' | 'needs_revision' | 'rejected') {
  const supabase = await createClient()

  // Verify the asset belongs to this token's project
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('share_token', token)
    .single()
  if (!project) throw new Error('Invalid review link.')

  const { error } = await supabase
    .from('creative_assets')
    .update({ status })
    .eq('id', assetId)
    .eq('project_id', project.id)

  if (error) throw new Error(error.message)

  // Side-effect: keep the Drive layout in sync with the client's decision.
  //   - reject → move file to Delete/ + soft-hide (best-effort).
  //   - un-reject (back to pending) → move it back + un-hide (best-effort).
  // Drive failures (no SA configured yet, no drive_folder_url on project, etc.)
  // are swallowed so the status update itself always succeeds — the team can
  // run the manual "Purge stale" button later.
  if (hasDriveServiceAccount()) {
    try {
      if (status === 'rejected') {
        await _archiveAssetCore(supabase, assetId, project.id)
      } else if (status === 'pending') {
        // Only attempt restore if it was previously archived.
        const { data: a } = await supabase
          .from('creative_assets')
          .select('is_hidden')
          .eq('id', assetId)
          .single()
        if (a?.is_hidden) {
          await _restoreAssetCore(supabase, assetId, project.id)
        }
      }
    } catch (err) {
      console.error('[updateAssetStatus] Drive sync failed (status update kept):', err)
    }
  }

  revalidatePath(`/review/${token}`)
}

// Authed internal version — accepts the wider status union (incl. 'rejected')
// and revalidates BOTH the internal project page and the client review surface
// (the client should see status changes the team makes from the internal page).
export async function updateAssetStatusInternal(
  assetId: string,
  projectId: string,
  brandId: string,
  status: 'pending' | 'approved' | 'needs_revision' | 'rejected'
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  // INTERNAL QC writes its OWN column — never the client-facing `status`. This
  // keeps an internal approve/reject from showing up on the client review link.
  const { error } = await supabase
    .from('creative_assets')
    .update({ internal_status: status })
    .eq('id', assetId)
    .eq('project_id', projectId)

  if (error) throw new Error(error.message)

  // Mirror the client-side reject behaviour from updateAssetStatus: keep Drive
  // in sync best-effort. Internal users get the same auto-archive on reject.
  if (hasDriveServiceAccount()) {
    try {
      if (status === 'rejected') {
        await _archiveAssetCore(supabase, assetId, projectId)
      } else if (status === 'pending') {
        const { data: a } = await supabase
          .from('creative_assets')
          .select('is_hidden')
          .eq('id', assetId)
          .single()
        if (a?.is_hidden) {
          await _restoreAssetCore(supabase, assetId, projectId)
        }
      }
    } catch (err) {
      console.error('[updateAssetStatusInternal] Drive sync failed (status update kept):', err)
    }
  }

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath(`/brands/${brandId}/projects/${projectId}/internal-review`)
  // Client review link revalidate (token unknown here — invalidate the segment).
  revalidatePath('/review', 'layout')
}

// Authed: post a comment from the internal review page. Always tagged
// audience='internal' so the client never sees it on their review link, and
// (importantly) so `applyAiEdits` can be scoped to internal-only feedback later.
export async function addInternalAssetComment(input: {
  projectId: string
  brandId: string
  assetId: string
  content: string
  displayName: string
  pin_x?: number
  pin_y?: number
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const name = input.displayName.trim() || user.email?.split('@')[0] || 'Team'

  const { error } = await supabase.from('project_comments').insert({
    project_id: input.projectId,
    author_name: name,
    content: input.content.trim(),
    track: 'image',
    asset_id: input.assetId,
    pin_x: input.pin_x ?? null,
    pin_y: input.pin_y ?? null,
    section_tag: null,
    audience: 'internal',
  })
  if (error) throw new Error(error.message)

  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}`)
  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}/internal-review`)
}

// Upload a reference image (used by "Ask Claude to edit") into Supabase storage.
// Returns the storage path (used as a handle by applyDirectPrompt) and a public URL.
export async function uploadInternalReference(formData: FormData): Promise<{ storagePath: string; publicUrl: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const file = formData.get('file') as File | null
  const assetId = (formData.get('asset_id') as string) || 'unknown'
  if (!file) throw new Error('No file provided.')

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const slug = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'ref'
  const path = `internal-references/${assetId}-${Date.now()}-${slug}.${ext}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('project-images')
    .upload(path, buffer, { contentType: file.type || 'image/png', upsert: false })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)
  return { storagePath: path, publicUrl }
}

// Apply a freeform, literal prompt to the asset's current image. Parallel to
// applyAiEdits but doesn't compile comments — the operator types the prompt.
//
// Reference-image trade-off (v1): `openai.images.edit` accepts a SINGLE image.
// If exactly one reference image is uploaded, we treat IT as the source (so the
// model sees "edit this reference"). Otherwise we keep the asset's current
// image as the source and append a brief note to the prompt naming how many
// references were uploaded for context. A future upgrade would use gpt-image-2's
// multimodal input directly to pass multiple images.
export async function applyDirectPrompt(input: {
  assetId: string
  projectId: string
  brandId: string
  prompt: string
  quality: 'low' | 'medium' | 'high'
  referenceImagePaths?: string[]
}): Promise<{ revisionUrl: string; prompt: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not set — add it in Vercel → Settings → Environment Variables.')

  const trimmedPrompt = (input.prompt || '').trim()
  if (!trimmedPrompt) throw new Error('Prompt is empty.')

  const { data: asset } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('id', input.assetId)
    .single()
  if (!asset) throw new Error('Asset not found.')

  const refs = input.referenceImagePaths ?? []

  // Decide the source image: current asset's display image (revision_url ??
  // drive original) is the default; if exactly one reference was uploaded, USE
  // that as the source so the model edits it directly. (See trade-off note above.)
  let sourceBuffer: Buffer
  let sourceName = 'creative.jpg'
  let sourceType = 'image/jpeg'

  if (refs.length === 1) {
    const { data: blob, error: dlError } = await supabase.storage.from('project-images').download(refs[0])
    if (dlError || !blob) throw new Error(`Failed to download reference image: ${dlError?.message ?? 'unknown'}`)
    sourceBuffer = Buffer.from(await blob.arrayBuffer())
    sourceName = refs[0].split('/').pop() ?? 'reference.png'
    sourceType = blob.type || 'image/png'
  } else if (asset.revision_url) {
    const res = await fetch(asset.revision_url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Failed to fetch current revision (HTTP ${res.status}).`)
    sourceBuffer = Buffer.from(await res.arrayBuffer())
    sourceType = res.headers.get('content-type') || 'image/png'
    sourceName = 'revision.png'
  } else {
    const driveUrl = `https://drive.google.com/uc?export=download&id=${asset.drive_file_id}`
    const res = await fetch(driveUrl, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Failed to download image from Drive (HTTP ${res.status}). Make sure the file is publicly shared.`)
    sourceBuffer = Buffer.from(await res.arrayBuffer())
  }

  let finalPrompt = trimmedPrompt
  if (refs.length > 1) {
    finalPrompt = `${trimmedPrompt}\n\n(Reference images uploaded by the team for context: ${refs.length} images. v1 limitation: only the source image is passed to the edit call — describe how to use the references in the prompt above.)`
  }

  const { default: OpenAI, toFile } = await import('openai')
  const openai = new OpenAI({ apiKey: openaiKey })
  const imageFile = await toFile(sourceBuffer, sourceName, { type: sourceType })

  const response = await (openai.images as unknown as {
    edit: (params: unknown) => Promise<{ data: Array<{ b64_json?: string }> }>
  }).edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size: 'auto',
    quality: input.quality,
  })

  const b64 = response.data[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data. Try again.')

  const revisionBuffer = Buffer.from(b64, 'base64')
  const revisionPath = `revisions/${input.assetId}-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage
    .from('project-images')
    .upload(revisionPath, revisionBuffer, { contentType: 'image/png', upsert: true })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(revisionPath)

  await supabase
    .from('creative_assets')
    .update({
      revision_url: publicUrl,
      revision_prompt: finalPrompt,
      revision_created_at: new Date().toISOString(),
    })
    .eq('id', input.assetId)

  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}`)
  revalidatePath(`/brands/${input.brandId}/projects/${input.projectId}/internal-review`)
  return { revisionUrl: publicUrl, prompt: finalPrompt }
}

export async function toggleAssetVisibility(assetId: string, isHidden: boolean, projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase
    .from('creative_assets')
    .update({ is_hidden: isHidden })
    .eq('id', assetId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function approveProject(token: string, track: 'lp' | 'creatives') {
  const supabase = await createClient()

  const field = track === 'lp' ? 'lp_approved' : 'creatives_approved'

  const { error } = await supabase
    .from('projects')
    .update({ [field]: true })
    .eq('share_token', token)

  if (error) throw new Error(error.message)

  revalidatePath(`/review/${token}`)
}

export async function deleteProject(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { error: imgErr } = await supabase.from('project_images').delete().eq('project_id', projectId)
  if (imgErr) throw new Error(`Failed to delete project images: ${imgErr.message}`)
  const { error: projErr } = await supabase.from('projects').delete().eq('id', projectId)
  if (projErr) throw new Error(`Failed to delete project: ${projErr.message}`)

  revalidatePath(`/brands/${brandId}`)
  redirect(`/brands/${brandId}`)
}

export async function deleteBrand(brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('brand_id', brandId)

  if (projects && projects.length > 0) {
    const ids = projects.map(p => p.id)
    const { error: imgErr } = await supabase.from('project_images').delete().in('project_id', ids)
    if (imgErr) throw new Error(`Failed to delete project images: ${imgErr.message}`)
    const { error: projErr } = await supabase.from('projects').delete().eq('brand_id', brandId)
    if (projErr) throw new Error(`Failed to delete projects: ${projErr.message}`)
  }

  const { error: brandErr } = await supabase.from('brands').delete().eq('id', brandId)
  if (brandErr) throw new Error(`Failed to delete brand: ${brandErr.message}`)

  revalidatePath('/')
  redirect('/')
}

export async function addProfitEngineer(name: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { error } = await supabase.from('profit_engineers').insert({ name: name.trim() })
  if (error) throw new Error(`Failed to add profit engineer: ${error.message}`)
  // The dropdown that consumes this list only appears on brand pages.
  revalidatePath('/brands', 'layout')
}

export async function addInternalNote(
  projectId: string,
  brandId: string,
  content: string,
  displayName: string,
  attachmentUrls?: string[] | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const name = displayName.trim() || user.email?.split('@')[0] || 'Team'
  const cleanedAttachments = (attachmentUrls ?? []).filter(u => typeof u === 'string' && u.length > 0)

  const { error } = await supabase.from('project_comments').insert({
    project_id: projectId,
    author_name: name,
    content: content.trim(),
    track: 'note',
    asset_id: null,
    pin_x: null,
    pin_y: null,
    section_tag: null,
    attachment_urls: cleanedAttachments.length > 0 ? cleanedAttachments : null,
    audience: 'internal',
  })
  if (error) throw new Error(`Failed to add note: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function lockProjectOffer(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { error } = await supabase.from('projects').update({
    offer_locked: true,
    offer_locked_at: new Date().toISOString(),
    offer_locked_by: user.email,
  }).eq('id', projectId)
  if (error) throw new Error(`Failed to lock offer: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function unlockProjectOffer(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { error } = await supabase.from('projects').update({
    offer_locked: false,
    offer_locked_at: null,
    offer_locked_by: null,
  }).eq('id', projectId)
  if (error) throw new Error(`Failed to unlock offer: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function confirmOfferByClient(token: string) {
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('share_token', token)
    .single()
  if (!project) throw new Error('Invalid review link.')

  const { error } = await supabase.from('projects').update({
    offer_locked: true,
    offer_locked_at: new Date().toISOString(),
    offer_locked_by: 'client',
  }).eq('id', project.id)
  if (error) throw new Error(`Failed to confirm offer: ${error.message}`)

  revalidatePath(`/review/${token}`)
}

export async function generateClientToken(brandId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { randomBytes } = await import('crypto')
  const token = randomBytes(20).toString('hex')

  const { error } = await supabase.from('brands').update({ client_token: token }).eq('id', brandId)
  if (error) throw new Error(`Failed to save client token: ${error.message}`)
  revalidatePath(`/brands/${brandId}`)
  return token
}

export async function renameJourney(journeyId: string, brandId: string, newName: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { error } = await supabase
    .from('journeys')
    .update({ name: newName.trim() })
    .eq('id', journeyId)
  if (error) throw new Error(`Failed to rename journey: ${error.message}`)

  revalidatePath(`/brands/${brandId}`)
}

export async function deleteJourney(journeyId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('journey_id', journeyId)

  if ((count ?? 0) > 0) throw new Error('Cannot delete a journey that still has projects assigned to it.')

  const { error } = await supabase.from('journeys').delete().eq('id', journeyId)
  if (error) throw new Error(`Failed to delete journey: ${error.message}`)

  revalidatePath(`/brands/${brandId}`)
}

export async function updateProjectDetails(
  projectId: string,
  brandId: string,
  values: {
    name: string
    due_date: string | null
    stage_brief_due_date: string | null
    stage_in_progress_due_date: string | null
    stage_internal_review_due_date: string | null
    stage_client_review_due_date: string | null
    offer_description: string | null
    offer: string | null
    cta: string | null
    headline: string | null
    body_copy: string | null
    supporting_message: string | null
    journey_id: string | null
    marketing_moment: 1 | 2 | null
    page_type: string | null
    product_featured: string | null
    product_description: string | null
    retail_price: string | null
    offer_dynamics_type: string | null
    competitor_reference: string | null
    client_ad_inspiration: string | null
    ad_copy_primary_text: string | null
    ad_copy_description: string | null
    ad_copy_url: string | null
    ad_headlines: string[] | null
    ad_subcopies: string[] | null
    ad_eyebrows: string[] | null
    product_images_link: string | null
    lp_url: string | null
    creatives_notes: string | null
    shopify_coupon_code: string | null
    assigned_designer: string | null
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { error } = await supabase
    .from('projects')
    .update(values)
    .eq('id', projectId)
  if (error) throw new Error(`Failed to update project: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

export async function assignProjectDesigner(
  projectId: string,
  brandId: string,
  designer: string | null,
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('projects')
    .update({ assigned_designer: designer })
    .eq('id', projectId)
  if (error) throw new Error(`Failed to assign designer: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

export async function saveProjectCopy(
  projectId: string,
  brandId: string,
  copy: { ad_headlines: string[]; ad_eyebrows: string[]; ad_subcopies: string[] }
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('projects')
    .update(copy)
    .eq('id', projectId)
  if (error) throw new Error(`Failed to save copy: ${error.message}`)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function generateProjectCopy(
  projectId: string,
): Promise<{ ok: true; headlines: string[]; eyebrows: string[]; subheads: string[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  try {
    const { data: project } = await supabase
      .from('projects')
      .select('offer, offer_description, brand_id')
      .eq('id', projectId)
      .single()

    if (!project) return { ok: false, error: 'Project not found.' }

    const offerText = [project.offer, project.offer_description].filter(Boolean).join('\n')
    if (!offerText.trim()) return { ok: false, error: 'Please fill in the offer fields before generating copy.' }

    const [{ data: brand }, { data: dna }] = await Promise.all([
      supabase.from('brands').select('name').eq('id', project.brand_id).single(),
      supabase.from('brand_dna').select('prompt_modifier').eq('brand_id', project.brand_id).eq('is_active', true).maybeSingle(),
    ])

    const { generateAdCopy } = await import('@/lib/ai/gemini')
    const deck = await generateAdCopy(
      offerText,
      brand?.name ?? 'Brand',
      dna?.prompt_modifier ?? '',
    )

    return { ok: true, headlines: deck.headlines, eyebrows: deck.eyebrows, subheads: deck.subheads }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// Brand DNA — Gemini-driven research + synthesis pass. Writes a new active row
// on `brand_dna` and flips any prior active row to is_active=false, so there's
// exactly one active version per brand. Expected runtime 30-90s; the brand
// page carries `maxDuration = 120` to accommodate.
//
// Returns { ok, error } instead of throwing: thrown errors from server actions
// are redacted to a generic "Server Components render" message in production,
// so the panel could never surface the real cause. Same pattern used by
// createProject above.
export async function buildBrandDna(
  brandId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) return { ok: false, error: 'Not authorized.' }

  try {
    const { data: brand } = await supabase
      .from('brands')
      .select('name, website')
      .eq('id', brandId)
      .single()
    if (!brand) return { ok: false, error: 'Brand not found.' }
    if (!brand.website) return { ok: false, error: 'Brand website is required to research DNA.' }

    const { researchBrandDna, synthesizeBrandDna } = await import('@/lib/ai/gemini')
    const { TEXT_FIELDS } = await import('@/lib/ai/brand-dna-schema')

    const { dossier, urls } = await researchBrandDna(brand.name, brand.website)
    const dna = await synthesizeBrandDna(dossier, urls)

    const normalized: Record<string, unknown> = { ...dna }
    for (const field of TEXT_FIELDS) {
      if (normalized[field] === '') normalized[field] = null
    }

    const { data: prevActive } = await supabase
      .from('brand_dna')
      .select('id, version, logo_url')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()

    if (prevActive) {
      const { error: flipErr } = await supabase.from('brand_dna').update({ is_active: false }).eq('id', prevActive.id)
      if (flipErr) return { ok: false, error: `Failed to deactivate prior Brand DNA: ${flipErr.message}` }
    }

    const insertRow = {
      ...normalized,
      brand_id: brandId,
      version: (prevActive?.version ?? 0) + 1,
      is_active: true,
      logo_url: prevActive?.logo_url ?? null,
    }

    const { error } = await supabase.from('brand_dna').insert(insertRow)
    if (error) return { ok: false, error: `Failed to save Brand DNA: ${error.message}` }

    revalidatePath(`/brands/${brandId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[buildBrandDna]', brandId, msg, e)
    return { ok: false, error: msg }
  }
}

export async function uploadBrandLogo(
  formData: FormData,
): Promise<{ ok: true; logoUrl: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) return { ok: false, error: 'Not authorized.' }

  try {
    const brandId = formData.get('brand_id') as string | null
    const file = formData.get('file') as File | null
    if (!brandId) return { ok: false, error: 'brand_id is required.' }
    if (!file) return { ok: false, error: 'No file provided.' }

    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `brand-logos/${brandId}-${Date.now()}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await supabase.storage
      .from('project-images')
      .upload(path, buffer, { contentType: file.type || 'image/png', upsert: false })
    if (uploadError) return { ok: false, error: `Storage upload failed: ${uploadError.message}` }

    const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)

    const { data: active } = await supabase
      .from('brand_dna')
      .select('id')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()

    if (active) {
      const { error } = await supabase.from('brand_dna').update({ logo_url: publicUrl }).eq('id', active.id)
      if (error) return { ok: false, error: `Failed to save logo URL: ${error.message}` }
    } else {
      // No DNA row yet — create a stub active row that just holds the logo, so
      // the panel has somewhere to persist the upload. A later Build pass will
      // supersede this with version=2.
      const { error } = await supabase.from('brand_dna').insert({
        brand_id: brandId,
        version: 1,
        is_active: true,
        logo_url: publicUrl,
      })
      if (error) return { ok: false, error: `Failed to save logo URL: ${error.message}` }
    }

    revalidatePath(`/brands/${brandId}`)
    return { ok: true, logoUrl: publicUrl }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[uploadBrandLogo]', msg, e)
    return { ok: false, error: msg }
  }
}
