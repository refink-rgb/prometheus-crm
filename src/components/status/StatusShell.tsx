// Page frame for the strategist status board: the same top bar as the client
// review link, so every no-login page reads as one product.

import BrandMark from '@/components/BrandMark'
import ThemeToggle from '@/components/ThemeToggle'

export function StatusShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--background)' }}>
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 var(--space-6)',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Prometheus
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 2 }}>by CTC</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Project status</span>
          <ThemeToggle />
        </div>
      </div>
      <main style={{ maxWidth: 980, margin: '0 auto', padding: 'var(--space-8) var(--space-6) 80px' }}>
        {children}
      </main>
    </div>
  )
}

export type TileTone = 'neutral' | 'good' | 'bad'

/** One summary number. A zero is shown quiet, whatever its tone. */
export function Tile({ label, value, unit, tone = 'neutral' }: {
  label: string
  value: number
  /** "project" or "file": pluralised here. */
  unit: string
  tone?: TileTone
}) {
  const color = value === 0
    ? 'var(--text-muted)'
    : tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'var(--text-primary)'
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '14px 16px', minWidth: 0,
    }}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
        {value}
        <span style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
          {unit}{value === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}

export function Tiles({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 12, margin: 'var(--space-5) 0 var(--space-8)',
    }}>
      {children}
    </div>
  )
}
