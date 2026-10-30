import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { loadClientCalibration } from '@/lib/bfcm/production-server'
import BfcmCalibrationReview from '@/components/bfcm/BfcmCalibrationReview'
import BrandMark from '@/components/BrandMark'
import ThemeToggle from '@/components/ThemeToggle'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Creative Calibration', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** Client calibration: the token opens one brand's published tracks and nothing else. */
export default async function BfcmCalibrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[a-f0-9]{64}$/.test(token)) notFound()
  const round = await loadClientCalibration(token)
  if (!round) notFound()
  const { data: plan } = await createServiceClient().from('bfcm_plans').select('config').eq('slug', round.slug).maybeSingle()
  const brandName = (plan?.config as { brand?: { name?: string } } | null)?.brand?.name ?? 'Your brand'

  return <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
    <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 var(--space-6)', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BrandMark size={28} />
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Prometheus</span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 2 }}>by CTC</span>
      </div>
      <ThemeToggle />
    </div>
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--space-10) var(--space-4) 80px' }}>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>{brandName} · Black Friday / Cyber Monday</p>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 'var(--space-4)' }}>Creative Calibration</h1>
      {round.tracks.length
        ? <BfcmCalibrationReview token={token} tracks={round.tracks} items={round.items} feedback={round.feedback} />
        : <div className="card"><p style={{ margin: 0, color: 'var(--text-secondary)' }}>Your creatives are being prepared. We’ll let you know when they’re ready to review.</p></div>}
    </main>
  </div>
}
