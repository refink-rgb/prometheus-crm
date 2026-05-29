import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NewProjectForm from '@/components/NewProjectForm'
import type { Journey } from '@/lib/types'

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ brandId: string }>
}) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: journeyRows } = await supabase
    .from('journeys')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })

  const journeys = (journeyRows ?? []) as Journey[]

  return <NewProjectForm brandId={brandId} journeys={journeys} />
}
