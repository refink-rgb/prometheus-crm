import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { COMMENT_COLUMNS, VIDEO_COLUMNS, isReviewToken, type EvergreenComment, type EvergreenVideo } from '@/lib/evergreen'
import EvergreenReviewPanel from '@/components/evergreen/EvergreenReviewPanel'
import BrandMark from '@/components/BrandMark'
import ThemeToggle from '@/components/ThemeToggle'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Evergreen Ad Review', robots: { index: false, follow: false }, referrer: 'no-referrer' }

// The client's review link for one evergreen ad. Runs as anon: the share_token
// is the gate, and rows are read with the service role because these tables
// have no anon policy (same model as the creative review link).
export default async function EvergreenReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isReviewToken(token)) notFound()

  const service = createServiceClient()
  const { data: ad } = await service.from('evergreen_ads')
    .select('id, name, stage, client_approved, is_archived, brands(name)')
    .eq('share_token', token).maybeSingle()
  if (!ad || ad.is_archived) notFound()

  const [{ data: videosRaw }, { data: commentsRaw }] = await Promise.all([
    service.from('evergreen_ad_videos').select(VIDEO_COLUMNS)
      .eq('ad_id', ad.id).eq('client_visible', true).order('sort_order').order('created_at'),
    // Never team notes, never feedback the team has checked off, never a
    // staff-authored row whatever its audience says.
    service.from('evergreen_ad_comments').select(COMMENT_COLUMNS)
      .eq('ad_id', ad.id).eq('audience', 'client').is('author_id', null).is('resolved_at', null).order('created_at'),
  ])

  // Only what the client view needs: no storage paths or uploader emails in the page payload.
  const videos = ((videosRaw ?? []) as unknown as EvergreenVideo[]).map(v => ({
    id: v.id, name: v.name, video_url: v.video_url, poster_url: v.poster_url, status: v.status, version: v.version,
  }))
  const comments = ((commentsRaw ?? []) as unknown as EvergreenComment[]).map(c => ({
    id: c.id, video_id: c.video_id, author_name: c.author_name, content: c.content, created_at: c.created_at,
  }))
  const brandName = (ad.brands as unknown as { name?: string } | null)?.name ?? ''

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 var(--space-6)', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Prometheus</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 2 }}>by CTC</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {ad.client_approved && <span className="badge badge-done">✓ Approved</span>}
          <ThemeToggle />
        </div>
      </div>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--space-10) var(--space-6) 80px' }}>
        <div style={{ marginBottom: 'var(--space-8)', maxWidth: 880 }}>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            {brandName ? `${brandName} · ` : ''}Evergreen ad
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 'var(--space-4)' }}>
            {ad.name}
          </h1>
          {ad.client_approved ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderRadius: 10,
              background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)',
            }}>
              <span style={{ fontSize: 20 }}>🎉</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>Approved — thank you!</span>
            </div>
          ) : (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderRadius: 10,
              background: 'var(--accent-muted)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
            }}>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                ⏳ Watch each video below. Approve it, or leave a comment saying what to change.
              </span>
            </div>
          )}
        </div>

        <EvergreenReviewPanel token={token} videos={videos} comments={comments} approved={ad.client_approved} />
      </main>
    </div>
  )
}
