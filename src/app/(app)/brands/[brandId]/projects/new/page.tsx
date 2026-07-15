import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { getCachedProfiles } from '@/lib/profiles'
import NewProjectForm from '@/components/NewProjectForm'
import type { Journey } from '@/lib/types'

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ brandId: string }>
}) {
  const { brandId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')

  const [{ data: journeyRows }, profiles] = await Promise.all([
    supabase
      .from('journeys')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }),
    getCachedProfiles(),
  ])

  const journeys = (journeyRows ?? []) as Journey[]

  return <NewProjectForm brandId={brandId} journeys={journeys} profiles={profiles} />
}
