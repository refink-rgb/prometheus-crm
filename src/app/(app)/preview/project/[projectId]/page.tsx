import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { getRevisionsByAsset } from '@/lib/revisions'
import type { Project, Brand, CreativeAsset, ProjectComment, BrandDna, ProjectImage } from '@/lib/types'
import PreviewProjectView from '@/components/preview/PreviewProjectView'

// PREVIEW ROUTE — deliberately not in the sidebar nav.
//
// This renders the editors' proposed tabbed layout against REAL data so the
// structure can be judged before anything is changed on the live project page.
// Nothing here writes: every control is inert (see the banner in the view).
// Deleting this folder + src/components/preview removes the whole experiment.
export default async function PreviewProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!(await canEdit(user.email))) redirect('/')

  const { data: projectRaw } = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (!projectRaw) notFound()
  const p = projectRaw as Project

  // One batch — everything keys off ids we already have.
  const [
    { data: brand },
    { data: assetsRaw },
    { data: commentsRaw },
    { data: imagesRaw },
    { data: dnaRaw },
    profiles,
  ] = await Promise.all([
    supabase.from('brands').select('id, name').eq('id', p.brand_id).single(),
    supabase.from('creative_assets').select('*').eq('project_id', projectId).eq('is_hidden', false).order('sort_order'),
    supabase.from('project_comments').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('project_images').select('id, storage_url').eq('project_id', projectId),
    supabase.from('brand_dna').select('*').eq('brand_id', p.brand_id).eq('is_active', true).maybeSingle(),
    getCachedProfiles(),
  ])

  const assets = (assetsRaw ?? []) as CreativeAsset[]
  const revisionsByAsset = await getRevisionsByAsset(supabase, assets.map(a => a.id))

  return (
    <PreviewProjectView
      project={p}
      brand={brand as Brand}
      assets={assets}
      comments={(commentsRaw ?? []) as ProjectComment[]}
      images={(imagesRaw ?? []) as ProjectImage[]}
      dna={(dnaRaw ?? null) as BrandDna | null}
      revisionsByAsset={revisionsByAsset}
      lpEditorName={profiles.find(x => x.id === p.lp_editor_id)?.full_name ?? null}
      creativeEditorName={profiles.find(x => x.id === p.creative_editor_id)?.full_name ?? null}
    />
  )
}
