'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/actions'
import ThemeToggle from '@/components/ThemeToggle'
import NotificationBell from '@/components/NotificationBell'

interface SidebarProps {
  email?: string | null
  showFinancials: boolean
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

export default function Sidebar({ email, showFinancials }: SidebarProps) {
  const pathname = usePathname()

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
  ]

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="app-sidebar" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 220,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
      }}>
        <div style={{ padding: '20px 20px 16px' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{
              width: 26, height: 26,
              background: 'var(--accent)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 13, color: 'white', flexShrink: 0,
            }}>P</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                Prometheus
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                Studio · CTC
              </div>
            </div>
          </Link>
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
                style={{
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
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '0 12px' }} />

        <div style={{ padding: '14px 16px 18px' }}>
          {email && (
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <NotificationBell />
            <ThemeToggle />
            <form action={signOut}>
              <button type="submit" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--sidebar-border)',
                borderRadius: 6,
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'border-color 0.12s, color 0.12s',
              }}>
                Log out
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
