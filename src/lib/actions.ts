'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Stage } from '@/lib/types'

export async function createBrand(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  const { data, error } = await supabase
    .from('projects')
    .insert({
      brand_id: brandId,
      name: formData.get('name') as string,
      due_date: formData.get('due_date') as string,
      offer_description: str('offer_description'),
      inspiration: str('inspiration'),
      offer_type: str('offer_type'),
      offer: str('offer'),
      discount: str('discount'),
      tiered_offer: str('tiered_offer'),
      headline: str('headline'),
      body_copy: str('body_copy'),
      supporting_message: str('supporting_message'),
      cta: str('cta'),
      journey_id,
      marketing_moment,
      page_type: str('page_type'),
      product_featured: str('product_featured'),
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)

  if (imageUrls.length > 0) {
    await supabase.from('project_images').insert(
      imageUrls.map(({ path, url }) => ({
        project_id: data.id,
        storage_path: path,
        storage_url: url,
      }))
    )
  }

  revalidatePath(`/brands/${brandId}`)
  return { redirect: `/brands/${brandId}/projects/${data.id}` }
}

export async function createJourney(brandId: string, name: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  const { data, error } = await supabase
    .from('journeys')
    .insert({ brand_id: brandId, name: name.trim() })
    .select()
    .single()

  if (error) throw new Error(error.message)
  revalidatePath(`/brands/${brandId}`)
  return data.id
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

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
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

  await supabase
    .from('brands')
    .update({ monthly_retainer, start_date, growth_strategist, is_active, is_trial, profit_engineer, pipeline_status, brand_notes })
    .eq('id', brandId)

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
  }
) {
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('share_token', token)
    .single()

  if (!project) throw new Error('Invalid review link.')

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
    })

  revalidatePath(`/review/${token}`)
}

export async function syncDriveImages(projectId: string, brandId: string, folderUrl: string): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY
  if (!apiKey) throw new Error('GOOGLE_DRIVE_API_KEY is not set in environment variables. Add it in Vercel → Settings → Environment Variables.')

  // Extract folder ID from various Drive URL formats
  const match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('Invalid Google Drive folder URL. Expected format: https://drive.google.com/drive/folders/...')
  const folderId = match[1]

  // First, save the folder URL on the project
  await supabase
    .from('projects')
    .update({ drive_folder_url: folderUrl })
    .eq('id', projectId)

  // Fetch folder contents from Drive API
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${apiKey}&fields=files(id,name,mimeType)&orderBy=name&pageSize=200`
  )

  if (!driveRes.ok) {
    const err = await driveRes.json()
    throw new Error(`Drive API error: ${err.error?.message ?? driveRes.statusText}`)
  }

  const driveData = await driveRes.json()
  const imageFiles = ((driveData.files ?? []) as Array<{ id: string; name: string; mimeType: string }>)
    .filter(f => f.mimeType.startsWith('image/'))

  const driveFileIds = imageFiles.map(f => f.id)

  // Remove assets no longer in Drive
  const { data: existing } = await supabase
    .from('creative_assets')
    .select('id, drive_file_id')
    .eq('project_id', projectId)

  const toDelete = (existing ?? []).filter(a => !driveFileIds.includes(a.drive_file_id))
  if (toDelete.length > 0) {
    await supabase
      .from('creative_assets')
      .delete()
      .in('id', toDelete.map(a => a.id))
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

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  return imageFiles.length
}

function describePosition(x: number, y: number): string {
  const h = x < 33 ? 'left' : x < 66 ? 'center' : 'right'
  const v = y < 25 ? 'top' : y < 75 ? 'middle' : 'bottom'
  return `${v}-${h}`
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

  const prompt = buildRevisionPrompt(comments)

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
    model: 'gpt-image-1',
    image: imageFile,
    prompt,
    n: 1,
    size: '1024x1024',
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

// Called from public review page via share token
export async function updateAssetStatus(token: string, assetId: string, status: 'pending' | 'approved' | 'needs_revision') {
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
  revalidatePath(`/review/${token}`)
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

  await supabase.from('project_images').delete().eq('project_id', projectId)
  await supabase.from('projects').delete().eq('id', projectId)

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
    await supabase.from('project_images').delete().in('project_id', ids)
    await supabase.from('projects').delete().eq('brand_id', brandId)
  }

  await supabase.from('brands').delete().eq('id', brandId)

  revalidatePath('/')
  redirect('/')
}

export async function addProfitEngineer(name: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase.from('profit_engineers').insert({ name: name.trim() })
  revalidatePath('/', 'layout')
}

export async function addInternalNote(projectId: string, brandId: string, content: string, displayName: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = displayName.trim() || user.email?.split('@')[0] || 'Team'

  await supabase.from('project_comments').insert({
    project_id: projectId,
    author_name: name,
    content: content.trim(),
    track: 'note',
    asset_id: null,
    pin_x: null,
    pin_y: null,
    section_tag: null,
  })

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function lockProjectOffer(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase.from('projects').update({
    offer_locked: true,
    offer_locked_at: new Date().toISOString(),
    offer_locked_by: user.email,
  }).eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
}

export async function unlockProjectOffer(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  await supabase.from('projects').update({
    offer_locked: false,
    offer_locked_at: null,
    offer_locked_by: null,
  }).eq('id', projectId)

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

  await supabase.from('projects').update({
    offer_locked: true,
    offer_locked_at: new Date().toISOString(),
    offer_locked_by: 'client',
  }).eq('id', project.id)

  revalidatePath(`/review/${token}`)
}

export async function generateClientToken(brandId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  if (!canEdit(user.email)) throw new Error('Not authorized.')

  const { randomBytes } = await import('crypto')
  const token = randomBytes(20).toString('hex')

  await supabase.from('brands').update({ client_token: token }).eq('id', brandId)
  revalidatePath(`/brands/${brandId}`)
  return token
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
