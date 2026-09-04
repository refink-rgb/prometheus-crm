import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import InternalReviewPanel from '@/components/InternalReviewPanel'
import type { Project, CreativeAsset, ProjectComment } from '@/lib/types'

// AI revision/edit Server Actions (gpt-image-2) run ~60-90s. Without this they hit
// Vercel's default function timeout and the client gets "unexpected response from
// the server". Page-level maxDuration covers all Server Actions used on this page.
export const maxDuration = 300

export default async function InternalReviewPage({
  params,
}: {
  params: Promise<{ brandId: string; projectId: string }>
}) {
  const { brandId, projectId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) redirect(`/brands/${brandId}/projects/${projectId}`)

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

  // Edit history per asset — drives the "Original / Edit 1 / Edit 2 …" strip.
  const { getRevisionsByAsset } = await import('@/lib/revisions')
  const revisionsByAsset = await getRevisionsByAsset(supabase, assets.map(a => a.id))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 32px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, flexWrap: 'wrap' }}>
          <Link href="/brands" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Brands</Link>
          <span style={{ opacity: 0.5 }}>/</span>
          <Link href={`/brands/${brandId}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Brand</Link>
          <span style={{ opacity: 0.5 }}>/</span>
          <Link href={`/brands/${brandId}/projects/${projectId}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{project.name}</Link>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--text-primary)' }}>Internal review</span>
        </div>
        <InternalReviewPanel
          projectId={projectId}
          brandId={brandId}
          assets={assets}
          initialComments={comments}
          projectName={project.name}
          currentUserName={userDisplayName}
          currentUserId={user.id}
          revisionsByAsset={revisionsByAsset}
        />
      </main>
    </div>
  )
}
