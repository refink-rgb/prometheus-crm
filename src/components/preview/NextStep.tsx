'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectStage } from '@/lib/actions'
import { normalizeStage, STAGE_LABELS, type Stage } from '@/lib/types'

// "Where do I submit my work?"
//
// The answer used to be: open a disclosure called "Move a stage" in the header
// and pick the next value off a seven-step rail. That is a description of the
// data model, not an instruction. An editor who has just finished a batch wants
// one button that says what happens next.
//
// So this states the current position in a sentence and offers exactly one
// forward action, named for the thing it actually does. The rail stays for
// anyone who needs to jump backwards or sideways.

type Track = 'lp_stage' | 'creatives_stage'

const NEXT: Record<Stage, { to: Stage; label: string; note: string } | null> = {
  brief:           { to: 'in_progress',     label: 'Start work',                note: 'Nobody else will pick it up.' },
  in_progress:     { to: 'internal_review', label: 'Submit for internal review', note: 'The team checks it first.' },
  internal_review: { to: 'client_review',   label: 'Send to client review',      note: 'Only visible creatives go.' },
  // The client moves this one by approving or commenting; an editor pushing it
  // forward would be claiming a decision that is not theirs.
  client_review:   null,
  revisions:       { to: 'internal_review', label: 'Submit revisions',           note: 'The team checks the fixes.' },
  ready:           { to: 'live',            label: 'Mark live',                  note: 'The ads are running.' },
  live:            null,
}

const WAITING: Partial<Record<Stage, string>> = {
  client_review: 'Waiting on the client.',
  live: 'Done.',
}

export default function NextStep({
  projectId, brandId, track, stage, label, disabled = false,
}: {
  projectId: string
  brandId: string
  track: Track
  stage: string | null
  label: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  const current = normalizeStage(stage)
  const next = NEXT[current]
  const waiting = WAITING[current]

  function advance() {
    if (!next) return
    setErr('')
    startTransition(async () => {
      try {
        await updateProjectStage(projectId, brandId, track, next.to)
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not move the stage.')
      }
    })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '12px 16px', marginBottom: 20, borderRadius: 10,
      border: `1px solid ${next && !disabled ? 'var(--accent)' : 'var(--border)'}`,
      background: next && !disabled ? 'var(--accent-muted)' : 'var(--surface-1)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          {label} · {STAGE_LABELS[current]}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
          {disabled ? 'Complete.' : (waiting ?? next?.note ?? '')}
        </div>
      </div>

      {next && !disabled && (
        <button
          onClick={advance}
          disabled={pending}
          style={{
            flexShrink: 0, fontSize: 12.5, fontWeight: 700, padding: '9px 16px', borderRadius: 8,
            cursor: pending ? 'wait' : 'pointer',
            border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff',
          }}
        >{pending ? 'Saving…' : `${next.label} →`}</button>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--danger)', width: '100%' }}>{err}</div>}
    </div>
  )
}
