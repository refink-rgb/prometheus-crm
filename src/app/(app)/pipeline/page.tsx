import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Project } from '@/lib/types'
import KanbanView from '@/components/KanbanView'

type PipelineProject = Project & { brands: { id: string; name: string } }

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const isEditor = canEdit(user.email)

  const { data: pipelineRaw } = await supabase
    .from('projects')
    .select('*, brands(id, name)')
    .eq('is_complete', false)
    .order('due_date', { ascending: true })

  const pipeline = (pipelineRaw ?? []) as PipelineProject[]

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
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
