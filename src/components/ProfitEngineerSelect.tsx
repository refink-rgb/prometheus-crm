'use client'

import { useState, useTransition } from 'react'
import { addProfitEngineer } from '@/lib/actions'

interface Props {
  engineers: string[]
  current: string | null
  fieldName?: string
}

export default function ProfitEngineerSelect({ engineers, current, fieldName = 'profit_engineer' }: Props) {
  const [list, setList] = useState<string[]>(engineers)
  const [selected, setSelected] = useState(current ?? '')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) return
    startTransition(async () => {
      await addProfitEngineer(trimmed)
      setList(prev => [...prev, trimmed])
      setSelected(trimmed)
      setNewName('')
      setAdding(false)
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          name={fieldName}
          value={selected}
          onChange={e => setSelected(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">Unassigned</option>
          {list.map(pe => (
            <option key={pe} value={pe}>{pe}</option>
          ))}
        </select>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--accent)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: 500,
            }}
          >
            + New
          </button>
        )}
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            type="text"
            placeholder="Enter name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
            autoFocus
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !newName.trim()}
            className="btn-primary"
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            {isPending ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName('') }}
            className="btn-secondary"
            style={{ padding: '8px 12px', fontSize: 13 }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
