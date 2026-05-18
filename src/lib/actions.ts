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
  const raw = (formData.get('website') as string).trim()
  const website = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  const { data, error } = await supabase
    .from('brands')
    .insert({ name, website, created_by: user.id })
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
  if (!user) return { redirect: '/login' }

  const brandId = formData.get('brand_id') as string
  const imageUrls = JSON.parse(formData.get('image_urls') as string) as Array<{ path: string; url: string }>

  const str = (key: string) => (formData.get(key) as string)?.trim() || null

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
