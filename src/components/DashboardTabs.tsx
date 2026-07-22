'use client'
import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Sub-navigation within the Dashboard section: toggles between the operational
// Dashboard (/) and the Insights analytics (/insights). Both live under the
// single "Dashboard" sidebar item — these tabs alternate the view.
const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/insights', label: 'Insights' },
]

export default function DashboardTabs() {
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function selectTab(href: string) {
    if (href === pathname) return
    startTransition(() => {
      router.push(href)
    })
  }

  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      gap: 0,
      borderBottom: '1px solid var(--border)',
      marginBottom: 'var(--space-5)',
    }}>
      {TABS.map(tab => {
        const isActive = pathname === tab.href
        return (
          <button
            key={tab.href}
            onClick={() => selectTab(tab.href)}
            disabled={isPending}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: isActive ? 700 : 500,
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
      {isPending && <div className="tab-loading-bar" />}
    </div>
  )
}
