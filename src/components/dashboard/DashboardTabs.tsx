'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

export type DashboardTab = 'financial' | 'management' | 'concerns'

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: 'financial', label: 'Financial' },
  { id: 'management', label: 'Management' },
  { id: 'concerns', label: 'Most Concerned' },
]

export default function DashboardTabs({ active, tabs, concernCount }: {
  active: DashboardTab
  tabs: DashboardTab[]
  concernCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <div role="tablist" style={{
      position: 'relative', display: 'flex', borderBottom: '1px solid var(--border)',
      marginBottom: 'var(--space-6)', overflowX: 'auto',
    }}>
      {TABS.filter(t => tabs.includes(t.id)).map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              if (isActive) return
              startTransition(() => router.push(tab.id === 'financial' ? '/' : `/?tab=${tab.id}`))
            }}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, cursor: isPending ? 'wait' : 'pointer', whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            {tab.label}
            {tab.id === 'concerns' && concernCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--text-primary)',
              }}>{concernCount}</span>
            )}
          </button>
        )
      })}
      {isPending && <div className="tab-loading-bar" />}
    </div>
  )
}
