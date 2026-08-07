'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { generateProjectCopy, saveProjectCopy } from '@/lib/actions'

interface Props {
  projectId: string
  brandId: string
  initialHeadlines: string[]
  initialEyebrows: string[]
  initialSubcopies: string[]
  /** Set for hypercare brands — generation is closed and copy comes from this person. */
  hypercareContact?: string | null
}

function ChipList({
  label,
  values,
  onChange,
}: {
  label: string
  values: string[]
  onChange: (next: string[]) => void
}) {
  const update = useCallback((i: number, v: string) => {
    const next = [...values]
    next[i] = v
    onChange(next)
  }, [values, onChange])

  const add = useCallback(() => onChange([...values, '']), [values, onChange])
  const remove = useCallback((i: number) => onChange(values.filter((_, idx) => idx !== i)), [values, onChange])

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {values.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={v}
              onChange={e => update(i, e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 16, padding: '0 4px', lineHeight: 1,
                flexShrink: 0,
              }}
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          style={{
            alignSelf: 'flex-start', fontSize: 12, color: 'var(--accent)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          + Add
        </button>
      </div>
    </div>
  )
}

export default function CopyDeckPanel({
  projectId,
  brandId,
  initialHeadlines,
  initialEyebrows,
  initialSubcopies,
  hypercareContact = null,
}: Props) {
  const router = useRouter()
  const [headlines, setHeadlines] = useState<string[]>(initialHeadlines)
  const [eyebrows, setEyebrows] = useState<string[]>(initialEyebrows)
  const [subcopies, setSubcopies] = useState<string[]>(initialSubcopies)

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const hasCopy = headlines.length > 0 || eyebrows.length > 0 || subcopies.length > 0

  async function handleGenerate() {
    // Hypercare: surface the warning without a round-trip. The server action
    // refuses too, so this is UX rather than the control.
    if (hypercareContact) {
      setError(`Reach out to ${hypercareContact} for ad copy`)
      return
    }
    setGenerating(true)
    setError('')
    setSaved(false)
    try {
      const result = await generateProjectCopy(projectId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setHeadlines(result.headlines)
      setEyebrows(result.eyebrows)
      setSubcopies(result.subheads)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await saveProjectCopy(projectId, brandId, {
        ad_headlines: headlines.filter(h => h.trim()),
        ad_eyebrows: eyebrows.filter(e => e.trim()),
        ad_subcopies: subcopies.filter(s => s.trim()),
      })
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>Copy Deck</h3>
        <button
          onClick={handleGenerate}
          disabled={generating}
          title={hypercareContact ? `Hypercare brand — reach out to ${hypercareContact} for ad copy` : undefined}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: (generating || hypercareContact) ? 'var(--surface-raised)' : 'var(--accent)',
            color: (generating || hypercareContact) ? 'var(--text-muted)' : 'white',
            border: hypercareContact ? '1px solid var(--border)' : 'none',
            cursor: generating ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {generating ? (
            <>
              <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'var(--text-muted)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              Generating…
            </>
          ) : (
            <>✦ Generate Copy</>
          )}
        </button>
      </div>

      {hypercareContact && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 8, color: 'var(--warning)', fontSize: 13, fontWeight: 600 }}>
          ⚠ Hypercare — reach out to {hypercareContact} for ad copy.{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>
            Copy generation is disabled for this brand.
          </span>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Hypercare brands always get the editors, even when empty: pasting copy
          in by hand is the only route now that generation is closed. */}
      {(hasCopy || hypercareContact) ? (
        <>
          {!hasCopy && hypercareContact && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              No copy yet. Paste the lines {hypercareContact} sends you into the fields below, then save.
            </p>
          )}
          <ChipList label="Headlines" values={headlines} onChange={setHeadlines} />
          <ChipList label="Eyebrows" values={eyebrows} onChange={setEyebrows} />
          <ChipList label="Subheadlines" values={subcopies} onChange={setSubcopies} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
              style={{ fontSize: 13 }}
            >
              {saving ? 'Saving…' : 'Save copy'}
            </button>
            {saved && (
              <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ Saved</span>
            )}
          </div>
        </>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Fill in the offer fields, then click <strong>✦ Generate Copy</strong> to generate headline, eyebrow, and subheadline options.
        </p>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
