import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Project } from '@/lib/types'
import KanbanView from '@/components/KanbanView'

type PipelineProject = Project & { brands: { id: string; name: string } }

export default async function PipelinePage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = canEdit(user.email)

  // Kanban cards read exactly these fields. `select('*')` was dragging the
  // JSONB copy banks + brief fields for every active project (~110 KB vs ~7 KB
  // measured) on every board load.
  const { data: pipelineRaw } = await supabase
    .from('projects')
    .select('id, name, brand_id, due_date, is_complete, lp_stage, creatives_stage, lp_approved, creatives_approved, assigned_designer, brands(id, name)')
    .eq('is_complete', false)
    .order('due_date', { ascending: true })

  const pipeline = (pipelineRaw ?? []) as unknown as PipelineProject[]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      padding: '20px 24px 16px',
      overflow: 'hidden',
    }}>
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Active Pipeline
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {pipeline.length} active project{pipeline.length !== 1 ? 's' : ''}
          {isEditor && ' · drag cards to advance a project’s stage'}
        </p>
      </div>

      <KanbanView pipeline={pipeline} />
    </div>
  )
}
