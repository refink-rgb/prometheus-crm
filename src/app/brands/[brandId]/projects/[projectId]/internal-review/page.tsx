import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import Nav from '@/components/Nav'
import InternalReviewPanel from '@/components/InternalReviewPanel'
import type { Project, CreativeAsset, ProjectComment } from '@/lib/types'

export default async function InternalReviewPage({
  params,
}: {
  params: Promise<{ brandId: string; projectId: string }>
}) {
  const { brandId, projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) redirect(`/brands/${brandId}/projects/${projectId}`)

  const { data: projectRaw } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (!projectRaw) notFound()

  const project = projectRaw as Project
  if (project.brand_id !== brandId) notFound()

  // Internal sees EVERYTHING (no client_visible filter) — internal review is
  // about what's about-to-be-published OR being-iterated.
  const [{ data: assetsRaw }, { data: commentsRaw }] = await Promise.all([
    supabase
      .from('creative_assets')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_hidden', false)
      .order('sort_order'),
    supabase
      .from('project_comments')
      .select('*')
      .eq('project_id', projectId)
      .eq('track', 'image')
      .order('created_at'),
  ])

  const assets = (assetsRaw ?? []) as CreativeAsset[]
  const comments = (commentsRaw ?? []) as ProjectComment[]
  const userDisplayName = user.email?.split('@')[0] ?? 'Team'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user.email} />
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px 80px' }}>
        <InternalReviewPanel
          projectId={projectId}
          brandId={brandId}
          assets={assets}
          initialComments={comments}
          projectName={project.name}
          currentUserName={userDisplayName}
        />
      </main>
    </div>
  )
}
