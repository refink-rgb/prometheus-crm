import BrandMark from '@/components/BrandMark'
import ThemeToggle from '@/components/ThemeToggle'

/** What a client sees on an old BFCM link while the season is paused (see lib/bfcm/season.ts). */
export default function BfcmSeasonClosed() {
  return <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
    <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 var(--space-6)', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BrandMark size={28} />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Prometheus</span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 2 }}>by CTC</span>
      </div>
      <ThemeToggle />
    </div>
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-10) var(--space-4) 80px' }}>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Black Friday / Cyber Monday</p>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 'var(--space-4)' }}>This season has wrapped</h1>
      <div className="card">
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Thanks for planning BFCM with us. This page is closed until next season.
          If you need any of your files, ask your account manager and we’ll send them over.
        </p>
      </div>
    </main>
  </div>
}
