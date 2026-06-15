'use client'

import { useState } from 'react'
import type { Project } from '@/lib/types'
import PipelineTable from './PipelineTable'
import KanbanView from './KanbanView'

type PipelineProject = Project & { brands: { id: string; name: string } }

export default function PipelineView({ pipeline }: { pipeline: PipelineProject[] }) {
  const [view, setView] = useState<'table' | 'kanban'>('table')

  function toggleBtnStyle(active: boolean): React.CSSProperties {
    return {
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400,
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'var(--accent-muted)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-muted)',
      transition: 'all 0.15s',
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 4 }}>
        <button onClick={() => setView('table')} style={toggleBtnStyle(view === 'table')}>
          <TableIcon active={view === 'table'} />
          Table
        </button>
        <button onClick={() => setView('kanban')} style={toggleBtnStyle(view === 'kanban')}>
          <KanbanIcon active={view === 'kanban'} />
          Kanban
        </button>
      </div>

      {view === 'table' ? (
        <PipelineTable pipeline={pipeline} />
      ) : (
        <KanbanView pipeline={pipeline} />
      )}
    </div>
  )
}

function TableIcon({ active }: { active: boolean }) {
  const op = active ? 1 : 0.6
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="12" height="2.5" rx="1" fill="currentColor" opacity={op} />
      <rect x="0.5" y="5" width="12" height="2.5" rx="1" fill="currentColor" opacity={op * 0.75} />
      <rect x="0.5" y="9.5" width="12" height="2.5" rx="1" fill="currentColor" opacity={op * 0.5} />
    </svg>
  )
}

function KanbanIcon({ active }: { active: boolean }) {
  const op = active ? 1 : 0.6
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="3" height="12" rx="1" fill="currentColor" opacity={op} />
      <rect x="5" y="0.5" width="3" height="8" rx="1" fill="currentColor" opacity={op * 0.75} />
      <rect x="9.5" y="0.5" width="3" height="5" rx="1" fill="currentColor" opacity={op * 0.5} />
    </svg>
  )
}
