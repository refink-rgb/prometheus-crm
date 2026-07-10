'use client'

import dynamic from 'next/dynamic'
import type { Project } from '@/lib/types'

const StageDistributionChart = dynamic(() => import('./StageDistributionChart'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: 160,
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }} />
  ),
})

export default function LazyStageDistributionChart(props: { projects: Project[] }) {
  return <StageDistributionChart {...props} />
}
