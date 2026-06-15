'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { renameJourney, deleteJourney } from '@/lib/actions'
import type { Journey } from '@/lib/types'

export default function JourneyHeader({
  journey,
  brandId,
  projectCount,
  isAuthorized,
}: {
  journey: Journey
  brandId: string
  projectCount: number
  isAuthorized: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(journey.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed === journey.name) { setEditing(false); return }
    setSaving(true)
    setError('')
    try {
      await renameJourney(journey.id, brandId, trimmed)
      setEditing(false)
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not rename journey.')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!confirm(`Delete journey "${journey.name}"? This cannot be undone.`)) return
    try {
      await deleteJourney(journey.id, brandId)
      router.refresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') { setName(journey.name); setEditing(false) }
  }

  const pillStyle = {
    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    background: 'var(--accent-muted)', border: '1px solid rgba(249,115,22,0.2)',
    borderRadius: 6, padding: '3px 10px',
  }

  if (editing) {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ ...pillStyle, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px 2px 10px' }}>
          🗓
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            style={{
              fontSize: 11, fontWeight: 700, color: 'var(--accent)',
              background: 'transparent', border: 'none', outline: 'none',
              padding: '1px 4px', width: 180, letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          />
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <button
          onClick={save}
          disabled={saving || !name.trim()}
          className="btn-primary"
          style={{ fontSize: 11, padding: '4px 10px' }}
        >
          {saving ? '…' : 'Save'}
        </button>
        <button
          onClick={() => { setName(journey.name); setEditing(false); setError('') }}
          disabled={saving}
          className="btn-secondary"
          style={{ fontSize: 11, padding: '4px 10px' }}
        >
          Cancel
        </button>
        </div>
        {error && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={pillStyle}>🗓 {journey.name}</div>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {projectCount} moment{projectCount !== 1 ? 's' : ''}
      </span>
      {isAuthorized && (
        <>
          <button
            onClick={() => setEditing(true)}
            title="Rename journey"
            style={{
              fontSize: 11, color: 'var(--text-muted)', background: 'none',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '3px 8px', cursor: 'pointer',
            }}
          >
            ✏ Rename
          </button>
          {projectCount === 0 && (
            <button
              onClick={doDelete}
              title="Delete journey"
              style={{
                fontSize: 11, color: 'var(--danger)', background: 'none',
                border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6,
                padding: '3px 8px', cursor: 'pointer',
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
    </div>
  )
}
