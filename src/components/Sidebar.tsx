'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/actions'
import ThemeToggle from '@/components/ThemeToggle'
import NotificationBell from '@/components/NotificationBell'
import type { CapacitySummary } from '@/lib/capacity'
import BrandMark from '@/components/BrandMark'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface SidebarProps {
  email?: string | null
  showFinancials: boolean
  // Management-only workload counters; null hides the block entirely.
  capacity?: CapacitySummary | null
}

function capacityColor(total: number): string {
  if (total === 0) return 'var(--text-muted)'
  if (total <= 2) return 'var(--success)'
  if (total <= 4) return '#F59E0B'
  return '#EF4444'
}

type NavItem = {
  href: string
  label: string
  matches: (pathname: string) => boolean
  icon: React.ReactNode
}

const iconSize = 18

const DashboardIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)

const FinancialsIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="3" x2="12" y2="21" />
    <path d="M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
)

const ResultsIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l5-6 4 4 5-7" />
    <polyline points="15 8 17 8 17 10" />
    <line x1="3" y1="21" x2="21" y2="21" strokeWidth="1.4" opacity="0.7" />
  </svg>
)

const PipelineIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="4" height="16" rx="1" />
    <rect x="10" y="4" width="4" height="10" rx="1" />
    <rect x="17" y="4" width="4" height="6" rx="1" />
  </svg>
)

const OffersIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.6 13.4L11 3.8A2 2 0 009.6 3.2H5a2 2 0 00-2 2v4.6c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 002.8 0l4.6-4.6a2 2 0 000-2.8z" />
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
  </svg>
)

const CalendarIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </svg>
)

const TimelineIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="12" height="4" rx="1.5" />
    <rect x="7" y="14" width="12" height="4" rx="1.5" />
    <line x1="12" y1="2" x2="12" y2="22" strokeWidth="1.4" opacity="0.7" />
  </svg>
)

const CapacityIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <line x1="2" y1="20" x2="22" y2="20" strokeWidth="1.4" opacity="0.7" />
  </svg>
)

const BrandsIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21V7a2 2 0 012-2h6a2 2 0 012 2v14" />
    <path d="M13 11h6a2 2 0 012 2v8" />
    <line x1="3" y1="21" x2="21" y2="21" />
    <line x1="6" y1="9" x2="6" y2="9.01" />
    <line x1="6" y1="13" x2="6" y2="13.01" />
    <line x1="6" y1="17" x2="6" y2="17.01" />
    <line x1="10" y1="9" x2="10" y2="9.01" />
    <line x1="10" y1="13" x2="10" y2="13.01" />
    <line x1="10" y1="17" x2="10" y2="17.01" />
    <line x1="16" y1="15" x2="16" y2="15.01" />
    <line x1="16" y1="19" x2="16" y2="19.01" />
  </svg>
)

const InspirationIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
)

const ShowcaseIcon = (
  <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M7 12l3-3 2 2 4-4" />
    <line x1="12" y1="16" x2="12" y2="20" />
    <line x1="8" y1="20" x2="16" y2="20" />
  </svg>
)

export default function Sidebar({ email, showFinancials, capacity = null }: SidebarProps) {
  const pathname = usePathname()

  // Collapsed to a 60px rail. Asked for by Janella, 1 Sep: reviewing creatives
  // on a laptop, the sidebar was eating the width the image grid needed.
  //
  // The width is published as a CSS variable rather than lifted into a context,
  // because the thing that has to react to it — the app layout — is a server
  // component. A variable lets it stay one.
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('prometheus-sidebar-collapsed') === '1')
    } catch { /* private window, or storage blocked — start expanded */ }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '60px' : '220px')
    try { localStorage.setItem('prometheus-sidebar-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed, ready])

  const items: NavItem[] = [
    {
      href: '/',
      label: 'Dashboard',
      // Insights lives under the Dashboard section as a sub-tab, so this item
      // stays active on both routes.
      matches: (p) => p === '/' || p.startsWith('/insights'),
      icon: DashboardIcon,
    },
    ...(showFinancials
      ? [{
          href: '/financials',
          label: 'Financials',
          matches: (p: string) => p.startsWith('/financials'),
          icon: FinancialsIcon,
        }]
      : []),
    {
      href: '/results',
      label: 'Results',
      matches: (p) => p.startsWith('/results'),
      icon: ResultsIcon,
    },
    {
      href: '/offers',
      label: 'Offers',
      matches: (p) => p.startsWith('/offers'),
      icon: OffersIcon,
    },
    {
      href: '/pipeline',
      label: 'Pipeline',
      matches: (p) => p.startsWith('/pipeline'),
      icon: PipelineIcon,
    },
    {
      href: '/calendar',
      label: 'Calendar',
      matches: (p) => p.startsWith('/calendar'),
      icon: CalendarIcon,
    },
    {
      href: '/timeline',
      label: 'Timeline',
      matches: (p) => p.startsWith('/timeline'),
      icon: TimelineIcon,
    },
    {
      href: '/capacity',
      label: 'Capacity Report',
      matches: (p) => p.startsWith('/capacity'),
      icon: CapacityIcon,
    },
    {
      href: '/brands',
      label: 'Brands',
      matches: (p) => p.startsWith('/brands'),
      icon: BrandsIcon,
    },
    {
      href: '/inspiration',
      label: 'Inspiration',
      matches: (p) => p.startsWith('/inspiration'),
      icon: InspirationIcon,
    },
    {
      href: '/marketing',
      label: 'Marketing',
      matches: (p) => p.startsWith('/marketing'),
      icon: ShowcaseIcon,
    },
  ]

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="app-sidebar" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: collapsed ? 60 : 220,
        transition: 'width 0.15s',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
      }}>
        {/* Header: mark + wordmark on the left at the same inset as the nav
            icons below, collapse control on the right of the same row. It used
            to centre the wordmark and park the button on its own row beneath,
            which read as three loose pieces. Collapsed, the mark stacks over
            the button, both centred in the 60px rail. */}
        <div style={{
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: collapsed ? 10 : 8,
          padding: collapsed ? '16px 0 12px' : '16px 10px 14px 16px',
        }}>
          <Link href="/" title={collapsed ? 'Prometheus' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}>
            <BrandMark size={28} />
            {/* Collapsed rail is 60px: only the mark fits. The wordmark used to
                stay mounted and overflow the rail. */}
            {!collapsed && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                  Prometheus
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  Studio · CTC
                </div>
              </div>
            )}
          </Link>

          <button
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
              border: '1px solid var(--sidebar-border)', background: 'transparent', color: 'var(--text-muted)',
            }}
          >
            {collapsed ? <PanelLeftOpen size={15} strokeWidth={2} aria-hidden /> : <PanelLeftClose size={15} strokeWidth={2} aria-hidden />}
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '0 12px' }} />

        <nav style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '12px 8px',
          flex: 1,
        }}>
          {items.map(item => {
            const active = item.matches(pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                style={{
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  background: active ? 'var(--accent-muted)' : 'transparent',
                  borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                  paddingLeft: active ? 9 : 12,
                  textDecoration: 'none',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <span style={{ display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {item.icon}
                </span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}

          {/* Team capacity — management only (capacity is null for others).
              A person's number = assigned tracks in brief / in progress /
              internal review / revisions; drops off at client review. */}
          {!collapsed && capacity && capacity.rows.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 12px 0', borderTop: '1px solid var(--sidebar-border)' }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
              }}>
                Capacity
              </div>
              {capacity.rows.map(r => (
                <div
                  key={r.id}
                  title={`${r.name} — LP: ${r.lp} · Creative: ${r.creative}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, padding: '3px 0', fontSize: 12,
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, flexShrink: 0,
                    color: capacityColor(r.total),
                    background: `color-mix(in srgb, ${capacityColor(r.total)} 12%, transparent)`,
                    borderRadius: 10, padding: '1px 8px', minWidth: 24, textAlign: 'center',
                  }}>
                    {r.total}
                  </span>
                </div>
              ))}
              {(capacity.unassignedLp > 0 || capacity.unassignedCreative > 0) && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  Unassigned: {capacity.unassignedLp > 0 && `${capacity.unassignedLp} LP`}
                  {capacity.unassignedLp > 0 && capacity.unassignedCreative > 0 && ' · '}
                  {capacity.unassignedCreative > 0 && `${capacity.unassignedCreative} Creative`}
                </div>
              )}
            </div>
          )}
        </nav>

        <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '0 12px' }} />

        {/* Collapsed rail: no room for the email or labels, so the three
            controls become a centered column of 30px icon buttons. */}
        <div style={{ padding: collapsed ? '14px 0 18px' : '14px 16px 18px' }}>
          {email && !collapsed && (
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 8,
            }}>
              {email}
            </div>
          )}
          <div style={{
            display: 'flex', gap: 6, alignItems: 'center',
            flexDirection: collapsed ? 'column' : 'row',
            flexWrap: collapsed ? 'nowrap' : 'wrap',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}>
            <NotificationBell />
            <ThemeToggle compact={collapsed} />
            <form action={signOut}>
              <button
                type="submit"
                title={collapsed ? `Log out${email ? ` (${email})` : ''}` : undefined}
                aria-label="Log out"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--sidebar-border)',
                  borderRadius: 6,
                  padding: collapsed ? 0 : '5px 10px',
                  width: collapsed ? 30 : undefined,
                  height: collapsed ? 30 : undefined,
                  fontSize: 11,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'border-color 0.12s, color 0.12s',
                }}
              >
                {collapsed ? <LogOutIcon /> : 'Log out'}
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="app-mobile-nav" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        background: 'var(--sidebar-bg)',
        borderTop: '1px solid var(--sidebar-border)',
        display: 'none',
        alignItems: 'stretch',
        justifyContent: 'space-around',
        zIndex: 40,
      }}>
        {items.map(item => {
          const active = item.matches(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                textDecoration: 'none',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 10,
                fontWeight: active ? 600 : 500,
                borderTop: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

function LogOutIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
