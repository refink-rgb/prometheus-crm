'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pipeline', label: 'Active Pipeline' },
  { id: 'brands', label: 'Brands' },
]

export default function DashboardTabs({ active }: { active: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function selectTab(id: string) {
    if (id === active) return
    startTransition(() => {
      router.push(`/?tab=${id}`)
    })
  }

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: '1px solid var(--border)',
      marginBottom: 32,
      opacity: isPending ? 0.7 : 1,
      transition: 'opacity 0.15s',
    }}>
      {TABS.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            disabled={isPending}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
              cursor: isPending ? 'wait' : 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
