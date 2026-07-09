import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import LpReviewPanel from '@/components/LpReviewPanel'
import ImageReviewPanel from '@/components/ImageReviewPanel'
import NotesThread from '@/components/NotesThread'
import ConfirmOfferButton from '@/components/ConfirmOfferButton'
import type { Project, Brand, ProjectImage, ProjectComment, CreativeAsset } from '@/lib/types'
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
  const canDeleteComments = canEdit(user?.email)

  const [
    { data: brandRaw },
    { data: images },
    { data: allComments },
    { data: assetsRaw },
  ] = await Promise.all([
    supabase.from('brands').select('*').eq('id', p.brand_id).single(),
    supabase.from('project_images').select('*').eq('project_id', p.id).order('created_at'),
    // Client review must NEVER show internal-only comments — exclude audience='internal'.
    supabase.from('project_comments').select('*').eq('project_id', p.id).neq('audience', 'internal').order('created_at'),
    supabase.from('creative_assets').select('*').eq('project_id', p.id).eq('is_hidden', false).eq('client_visible', true).order('sort_order'),
  ])

  const brand = brandRaw as Brand | null
  const imgs = (images ?? []) as ProjectImage[]
  const comments = (allComments ?? []) as ProjectComment[]
  const assets = (assetsRaw ?? []) as CreativeAsset[]

  const lpComments = comments.filter(c => c.track === 'lp' || c.track === 'general')
  const imageComments = comments.filter(c => c.track === 'image')
  const notes = comments.filter(c => c.track === 'note')

  const due = parseDueDate(p.due_date)
  const dueStr = due?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      {/* Top bar */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
          Prometheus Studio
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {p.lp_approved && <span className="badge badge-done" style={{ fontSize: 12 }}>✓ LP Approved</span>}
          {p.creatives_approved && <span className="badge badge-done" style={{ fontSize: 12 }}>✓ Creatives Approved</span>}
        </div>
      </div>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
            {brand?.name} {dueStr ? `· Due ${dueStr}` : ''}
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 16 }}>
            {p.name}
          </h1>

          {p.lp_approved && p.creatives_approved ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10 }}>
              <span style={{ fontSize: 20 }}>🎉</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>Both tracks approved — thank you!</span>
            </div>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 10 }}>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                ⏳ Review the deliverables below. Approve each track when you're happy.
              </span>
            </div>
          )}
        </div>

        {/* Landing Page track */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle>Landing Page</SectionTitle>
          <LpReviewPanel
            token={token}
            lpUrl={p.lp_url}
            lpApproved={p.lp_approved}
            initialComments={lpComments}
            canDelete={canDeleteComments}
          />
        </section>

        {/* Creatives track */}
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionTitle>
              Creatives {assets.length > 0 ? `(${assets.length})` : ''}
            </SectionTitle>
            {assets.length > 0 && (
              <a
                href={`/api/review/${token}/download`}
                download
                title={`Download all ${assets.length} creatives as a zip`}
                style={{
                  fontSize: 13, fontWeight: 600, textDecoration: 'none', padding: '8px 14px', borderRadius: 8,
                  border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)',
                }}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>Creatives approved</span>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Offer Details */}
        {(p.offer_description || p.inspiration || p.headline || p.body_copy || p.supporting_message || p.offer || p.cta || p.discount || p.tiered_offer || p.product_featured) && (
          <section style={{ marginBottom: 28 }}>
            <SectionTitle>Offer Details</SectionTitle>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {p.offer && <FieldBlock label="Offer / Promo" value={p.offer} />}
                  {p.discount && <FieldBlock label="Discount" value={p.discount} />}
                  {p.cta && <FieldBlock label="Call to Action" value={p.cta} />}
                </div>
              )}
              {p.tiered_offer && (
                <div style={{ padding: '12px 14px', background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
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
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                {p.offer_locked ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8 }}>
                    <span style={{ fontSize: 18 }}>🔒</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>Offer Confirmed</div>
                      {p.offer_locked_at && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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

        {/* Brief / Product Images */}
        {imgs.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <SectionTitle>Product Images ({imgs.length})</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {imgs.map((img, i) => (
                <a key={img.id} href={img.storage_url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.storage_url}
                    alt={`Product ${i + 1}`}
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Notes thread */}
        <section style={{ marginBottom: 28 }}>
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
