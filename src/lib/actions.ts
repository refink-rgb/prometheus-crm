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

export async function addProjectComment(token: string, authorName: string, content: string) {
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('share_token', token)
    .single()

  if (!project) throw new Error('Invalid review link.')

  await supabase
    .from('project_comments')
    .insert({ project_id: project.id, author_name: authorName.trim(), content: content.trim() })

  revalidatePath(`/review/${token}`)
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

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
