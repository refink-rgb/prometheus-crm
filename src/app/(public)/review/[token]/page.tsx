import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import LpReviewPanel from '@/components/LpReviewPanel'
import ImageReviewPanel from '@/components/ImageReviewPanel'
import NotesThread from '@/components/NotesThread'
import ConfirmOfferButton from '@/components/ConfirmOfferButton'
import ThemeToggle from '@/components/ThemeToggle'
import type { Project, Brand, ProjectComment, CreativeAsset } from '@/lib/types'
import { parseDueDate } from '@/lib/stageColors'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()

  const { data: projectRaw } = await supabase
    .from('projects')
    .select('*')
    .eq('share_token', token)
    .single()

  if (!projectRaw) notFound()

  const p = projectRaw as Project

  // Only authenticated editors (agency staff) can delete comments — anonymous
  // clients viewing this link cannot. The flag is passed down to the panels.
  const { data: { user } } = await supabase.auth.getUser()
  const canDeleteComments = await canEdit(user?.email)

  const [
    { data: brandRaw },
    { data: allComments },
    { data: assetsRaw },
  ] = await Promise.all([
    supabase.from('brands').select('id, name').eq('id', p.brand_id).single(),
    // Client review must NEVER show internal-only comments — exclude audience='internal'.
    supabase.from('project_comments').select('*').eq('project_id', p.id).neq('audience', 'internal').order('created_at'),
    supabase.from('creative_assets').select('*').eq('project_id', p.id).eq('is_hidden', false).eq('client_visible', true).order('sort_order'),
  ])

  const brand = brandRaw as Brand | null
  const comments = (allComments ?? []) as ProjectComment[]
  const assets = (assetsRaw ?? []) as CreativeAsset[]

  // Feedback the team has checked off internally (resolved_at set) must drop off
  // the client link entirely — same rule as audience='internal'. The notes thread
  // has no resolve toggle, so it's unaffected.
  const openComments = comments.filter(c => c.resolved_at == null)
  const lpComments = openComments.filter(c => c.track === 'lp' || c.track === 'general')
  const imageComments = openComments.filter(c => c.track === 'image')
  const notes = comments.filter(c => c.track === 'note')

  const due = parseDueDate(p.due_date)
  const dueStr = due?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top bar — mirrors Nav's logo mark / height / sticky behaviour so the
          client link reads as the same product as the internal app. */}
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
          <div style={{
            width: 28, height: 28,
            background: 'var(--accent)',
            borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 14, color: 'white', flexShrink: 0,
          }}>P</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Prometheus
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 2 }}>by CTC</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {p.lp_approved && <span className="badge badge-done">✓ LP Approved</span>}
          {p.creatives_approved && <span className="badge badge-done">✓ Creatives Approved</span>}
          <ThemeToggle />
        </div>
      </div>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: 'var(--space-10) var(--space-6) 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 'var(--space-8)', ...TEXT_COLUMN }}>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            {brand?.name} {dueStr ? `· Due ${dueStr}` : ''}
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 'var(--space-4)' }}>
            {p.name}
          </h1>

          {p.lp_approved && p.creatives_approved ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)', borderRadius: 10,
              background: 'color-mix(in srgb, var(--success) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)',
            }}>
              <span style={{ fontSize: 20 }}>🎉</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>Both tracks approved — thank you!</span>
            </div>
          ) : (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)', borderRadius: 10,
              background: 'var(--accent-muted)',
              border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
            }}>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                ⏳ Review the deliverables below. Approve each track when you&apos;re happy.
              </span>
            </div>
          )}
        </div>

        {/* Landing Page track — spans the full (widened) main so the desktop
            preview has room to read like a real desktop after scaling. */}
        <section style={{ marginBottom: 'var(--space-8)' }}>
          <SectionTitle>Landing Page</SectionTitle>
          <LpReviewPanel
            token={token}
            lpUrl={p.lp_url}
            lpApproved={p.lp_approved}
            initialComments={lpComments}
            canDelete={canDeleteComments}
          />
        </section>

        {/* Creatives track — capped narrower than the LP so the images keep
            their original (smaller) size; the LP needs the full width, creatives
            don't. */}
        <section style={{ marginBottom: 'var(--space-8)', maxWidth: 960 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <SectionTitle>
              Creatives {assets.length > 0 ? `(${assets.length})` : ''}
            </SectionTitle>
            {assets.length > 0 && (
              <a
                href={`/api/review/${token}/download`}
                download
                title={`Download all ${assets.length} creatives as a zip`}
                className="btn-secondary btn-sm"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-muted)' }}
              >
                ⬇ Download all ({assets.length})
              </a>
            )}
          </div>

          {assets.length > 0 ? (
            <ImageReviewPanel
              token={token}
              assets={assets}
              creativesApproved={p.creatives_approved}
              initialComments={imageComments}
              canDelete={canDeleteComments}
            />
          ) : (
            <div className="card">
              {p.creatives_notes ? (
                <div style={{ marginBottom: p.creatives_approved ? 0 : 20 }}>
                  <FieldLabel>Link / Notes</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                    {p.creatives_notes}
                  </div>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: p.creatives_approved ? 0 : 20 }}>
                  Creatives coming soon — check back later.
                </p>
              )}
              {p.creatives_approved ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: 'var(--space-3) var(--space-3)', borderRadius: 8,
                  background: 'color-mix(in srgb, var(--success) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
                }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--success)' }}>Creatives approved</span>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Offer Details */}
        {(p.offer_description || p.inspiration || p.headline || p.body_copy || p.supporting_message || p.offer || p.cta || p.discount || p.tiered_offer || p.product_featured) && (
          <section style={{ marginBottom: 'var(--space-8)', ...TEXT_COLUMN }}>
            <SectionTitle>Offer Details</SectionTitle>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {p.product_featured && (
                <div>
                  <FieldLabel>Product Featured</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>📦 {p.product_featured}</div>
                </div>
              )}
              {p.offer_description && (
                <div>
                  <FieldLabel>Overview</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{p.offer_description}</div>
                </div>
              )}
              {p.inspiration && (
                <div>
                  <FieldLabel>Inspiration</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{p.inspiration}</div>
                </div>
              )}
              {(p.offer || p.discount || p.cta) && (
                // .form-grid-2 collapses to one column under 768px, matching the app's forms.
                <div className="form-grid-2">
                  {p.offer && <FieldBlock label="Offer / Promo" value={p.offer} />}
                  {p.discount && <FieldBlock label="Discount" value={p.discount} />}
                  {p.cta && <FieldBlock label="Call to Action" value={p.cta} />}
                </div>
              )}
              {p.tiered_offer && (
                <div style={{ padding: 'var(--space-3)', background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <FieldLabel>Tiered Discount</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{p.tiered_offer}</div>
                </div>
              )}
              {p.headline && (
                <div>
                  <FieldLabel>Hero Headline</FieldLabel>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{p.headline}</div>
                </div>
              )}
              {p.body_copy && (
                <div>
                  <FieldLabel>Body Copy</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{p.body_copy}</div>
                </div>
              )}
              {p.supporting_message && (
                <div>
                  <FieldLabel>Supporting Message</FieldLabel>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{p.supporting_message}</div>
                </div>
              )}

              {/* Offer confirm/lock */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
                {p.offer_locked ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: 'var(--space-3)', borderRadius: 8,
                    background: 'color-mix(in srgb, var(--success) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
                  }}>
                    <span style={{ fontSize: 18 }}>🔒</span>
                    <div>
                      <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--success)' }}>Offer Confirmed</div>
                      {p.offer_locked_at && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          Locked on {new Date(p.offer_locked_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <ConfirmOfferButton token={token} />
                )}
              </div>
            </div>
          </section>
        )}

        {/* Notes thread */}
        <section style={{ marginBottom: 'var(--space-8)', ...TEXT_COLUMN }}>
          <SectionTitle>Notes & Messages</SectionTitle>
          <div className="card">
            <NotesThread
              notes={notes}
              mode="client"
              token={token}
              canDelete={canDeleteComments}
            />
          </div>
        </section>

      </main>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

// The review deliverables (LP + Creatives) span the full widened main so the
// desktop preview reads like a desktop; the prose sections stay capped at a
// comfortable reading width and left-aligned beneath them.
const TEXT_COLUMN: React.CSSProperties = { maxWidth: 880 }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </h2>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
      {children}
    </div>
  )
}

function FieldBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}
