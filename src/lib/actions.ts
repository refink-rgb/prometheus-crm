'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Stage } from '@/lib/types'

export async function createBrand(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  const website = formData.get('website') as string

  const { data, error } = await supabase
    .from('brands')
    .insert({ name, website, created_by: user.id })
    .select()
    .single()

  if (error) throw new Error(error.message)

  redirect(`/brands/${data.id}`)
}

export async function createProject(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const brandId = formData.get('brand_id') as string
  const imageUrls = JSON.parse(formData.get('image_urls') as string) as Array<{ path: string; url: string }>

  const { data, error } = await supabase
    .from('projects')
    .insert({
      brand_id: brandId,
      name: formData.get('name') as string,
      due_date: formData.get('due_date') as string,
      font: formData.get('font') as string || null,
      author: formData.get('author') as string || null,
      offer: formData.get('offer') as string || null,
      discount: formData.get('discount') as string || null,
      headline: formData.get('headline') as string || null,
      body_copy: formData.get('body_copy') as string || null,
      cta: formData.get('cta') as string || null,
      target_audience: formData.get('target_audience') as string || null,
      assigned_designer: formData.get('assigned_designer') as string || null,
      notes: formData.get('notes') as string || null,
      created_by: user.id,
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
  redirect(`/brands/${brandId}/projects/${data.id}`)
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

export async function markProjectComplete(projectId: string, brandId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await supabase
    .from('projects')
    .update({ is_complete: true, lp_stage: 'done', creatives_stage: 'done' })
    .eq('id', projectId)

  revalidatePath(`/brands/${brandId}/projects/${projectId}`)
  revalidatePath('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
