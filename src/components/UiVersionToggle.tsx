'use client'

import { useTransition } from 'react'
import { setUiVersion } from '@/lib/ui-version-actions'
import type { UiVersion } from '@/lib/ui-version'

// Sidebar control for switching interface generations. Renders the CURRENT
// version as the active half so there is never any doubt which one you are
// looking at — the most common way a preview flag goes wrong is a user
// reporting a bug against the version they did not realise they were on.
export default function UiVersionToggle({ current }: { current: UiVersion }) {
  const [pending, startTransition] = useTransition()

  const pick = (v: UiVersion) => {
    if (v === current || pending) return
    startTransition(() => { setUiVersion(v) })
  }

  return (
    <div
      title={current === 'v2'
        ? 'You are on the 2.0 preview. Switch back any time — nothing you do is version-specific.'
        : 'Switch to the 2.0 preview of the interface.'}
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        border: '1px solid var(--sidebar-border)', borderRadius: 6,
        overflow: 'hidden', opacity: pending ? 0.5 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {(['v1', 'v2'] as const).map(v => {
        const active = current === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => pick(v)}
            disabled={pending}
            aria-pressed={active}
            style={{
              padding: '4px 9px',
              fontSize: 10,
              fontWeight: active ? 700 : 500,
              letterSpacing: '0.04em',
              border: 'none',
              cursor: pending ? 'wait' : active ? 'default' : 'pointer',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-muted)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {v === 'v1' ? '1.0' : '2.0'}
          </button>
        )
      })}
    </div>
  )
}
