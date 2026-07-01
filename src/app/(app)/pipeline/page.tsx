import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import type { Brand } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER } from '@/lib/types'
import BDPipelineKanban from '@/components/BDPipelineKanban'

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isEditor = canEdit(user?.email)

  const { data: brandsRaw } = await supabase
    .from('brands')
    .select('*')
    .order('name', { ascending: true })

  const brands = (brandsRaw ?? []) as Brand[]

  const perStage = PIPELINE_STATUS_ORDER.map(status => ({
    status,
    count: brands.filter(b => b.pipeline_status === status).length,
  }))

  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          BD Pipeline
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          {perStage
            .map(s => `${s.count} ${PIPELINE_STATUS_LABELS[s.status]}`)
            .join(' · ')}
          {isEditor && ' · drag to move'}
        </p>
      </div>

      <BDPipelineKanban brands={brands} canEdit={isEditor} />
    </div>
  )
}
