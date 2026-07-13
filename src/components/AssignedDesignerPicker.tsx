'use client'

import { useState, useTransition } from 'react'
import { assignProjectDesigner } from '@/lib/actions'
import { DESIGNERS } from '@/lib/types'

interface Props {
  projectId: string
  brandId: string
  current: string | null
}

export default function AssignedDesignerPicker({ projectId, brandId, current }: Props) {
  const [value, setValue] = useState(current ?? '')
  const [, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setValue(next)
    startTransition(() => {
      assignProjectDesigner(projectId, brandId, next || null)
    })
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      style={{
        fontSize: 13,
        fontWeight: 500,
        color: value ? '#a855f7' : 'var(--text-muted)',
        background: value ? 'rgba(168,85,247,0.08)' : 'var(--surface-raised)',
        border: `1px solid ${value ? 'rgba(168,85,247,0.3)' : 'var(--border)'}`,
        borderRadius: 7,
        padding: '5px 10px',
        cursor: 'pointer',
        width: 'fit-content',
      }}
    >
      <option value="">Unassigned</option>
      {DESIGNERS.map(d => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  )
}
