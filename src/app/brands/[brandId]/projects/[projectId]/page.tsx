import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import StageTracker from '@/components/StageTracker'
import { markProjectComplete, updateProjectDeliverable, deleteProject } from '@/lib/actions'
import { canEdit } from '@/lib/permissions'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import ShareButton from '@/components/ShareButton'
import RevisionsToggle from '@/components/RevisionsToggle'
import type { Project, Brand, ProjectImage, Journey, Stage } from '@/lib/types'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ brandId: string; projectId: string }>
}) {
  const { brandId, projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data: brand } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  const { data: images } = await supabase
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)

  const p = project as Project
  const b = brand as Brand
  const imgs = (images ?? []) as ProjectImage[]
  const isAuthorized = canEdit(user?.email)

  // Fetch journey if project has one
  let journey: Journey | null = null
  if (p.journey_id) {
    const { data: jData } = await supabase
      .from('journeys')
      .select('*')
      .eq('id', p.journey_id)
      .single()
    journey = jData as Journey | null
  }

  const due = p.due_date ? new Date(p.due_date) : null
  const isOverdue = due && due < new Date() && !p.is_complete
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

  const bothDone = p.lp_stage === 'done' && p.creatives_stage === 'done'

  const STAGE_PCT: Record<Stage, number> = { brief: 25, in_progress: 50, review: 75, done: 100 }
  const overallPct = Math.round((STAGE_PCT[p.lp_stage] + STAGE_PCT[p.creatives_stage]) / 2)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user?.email} />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28, fontSize: 13, color: 'var(--text-muted)' }}>
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Dashboard</Link>
          <span>/</span>
          <Link href={`/brands/${brandId}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{b?.name}</Link>
          <span>/</span>
          <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 36 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                {p.name}
              </h1>
              {p.is_complete && <span className="badge badge-done">✓ Complete</span>}
              {p.lp_approved && <span className="badge badge-done">✓ LP Approved</span>}
              {p.creatives_approved && <span className="badge badge-done">✓ Creatives Approved</span>}
              {p.needs_revisions && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)', padding: '3px 8px', borderRadius: 6 }}>
                  ↩ Revisions Needed
                </span>
              )}
              {!p.is_complete && isOverdue && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '3px 8px', borderRadius: 6 }}>OVERDUE</span>}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
                Due: <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: isOverdue ? 600 : 400 }}>{dueStr}</span>
              </p>
              {journey && (
                <span style={{ fontSize: 13, color: 'var(--accent)' }}>
                  🗓 {journey.name}{p.marketing_moment ? ` · Moment ${p.marketing_moment}` : ''}
                </span>
              )}
              {p.page_type && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                  {p.page_type}
                </span>
              )}
            </div>
          </div>
          {isAuthorized && (
            <ConfirmDeleteForm
              action={deleteProject.bind(null, projectId, brandId)}
              message={`Delete "${p.name}"? This cannot be undone.`}
            >
              <button type="submit" style={{
                background: 'transparent',
                color: 'var(--danger)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}>
                Delete project
              </button>
            </ConfirmDeleteForm>
          )}
        </div>

        {/* ── Progress Banner — visible to everyone ── */}
        <div className="card" style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Project Progress
            </span>
            <span style={{
              fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em',
              color: overallPct === 100 ? 'var(--success)' : 'var(--accent)',
            }}>
              {overallPct}%
            </span>
          </div>

          {/* Overall fill bar */}
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 24, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              width: `${overallPct}%`,
              background: overallPct === 100 ? 'var(--success)' : 'var(--accent)',
              transition: 'width 0.4s ease',
            }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <TrackSteps label="Landing Page" stage={p.lp_stage} />
            <TrackSteps label="Creatives & Statics" stage={p.creatives_stage} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Complete banner */}
            {p.is_complete && (
              <div style={{
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 12,
                padding: '20px 24px',
              }}>
                <h3 style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 8, fontSize: 16 }}>
                  🎉 Project Complete
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  Both tracks are done. All deliverables are below.
                </p>
              </div>
            )}

            {/* Mark complete CTA */}
            {!p.is_complete && bothDone && isAuthorized && (
              <div style={{
                background: 'rgba(249,115,22,0.08)',
                border: '1px solid rgba(249,115,22,0.2)',
                borderRadius: 12,
                padding: '20px 24px',
              }}>
                <h3 style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 8, fontSize: 16 }}>
                  Both tracks are done!
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
                  Mark this project complete to archive it and surface all deliverables for the strategist.
                </p>
                <form action={markProjectComplete.bind(null, projectId, brandId)}>
                  <button type="submit" className="btn-primary">
                    ✓ Mark project complete
                  </button>
                </form>
              </div>
            )}

            {/* Project Meta — product featured + revisions */}
            {(p.product_featured || isAuthorized) && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: 'var(--text-primary)' }}>Project Info</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {p.product_featured && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Product Featured</div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>📦 {p.product_featured}</div>
                    </div>
                  )}
                  {journey && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Journey</div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                        🗓 {journey.name}
                        {p.marketing_moment && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· Moment {p.marketing_moment} ({p.marketing_moment === 1 ? '1st half' : '2nd half'} of month)</span>}
                      </div>
                    </div>
                  )}
                  {isAuthorized && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Revision Flag</div>
                      <RevisionsToggle
                        projectId={projectId}
                        brandId={brandId}
                        currentValue={p.needs_revisions}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Offer Description */}
            {(p.offer_description || p.inspiration) && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: 'var(--text-primary)' }}>Offer Description</h3>
                {p.offer_description && (
                  <div style={{ marginBottom: p.inspiration ? 16 : 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Overview</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{p.offer_description}</div>
                  </div>
                )}
                {p.inspiration && (
                  <div style={{ paddingTop: p.offer_description ? 16 : 0, borderTop: p.offer_description ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Inspiration</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{p.inspiration}</div>
                  </div>
                )}
              </div>
            )}

            {/* Copy & Offer */}
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 20, color: 'var(--text-primary)' }}>Copy & Offer</h3>

              {/* Offer pills */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                {[
                  { label: 'Offer / Promo', value: p.offer },
                  { label: 'Discount', value: p.discount },
                  { label: 'CTA', value: p.cta },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{value}</div>
                  </div>
                ) : null)}
              </div>

              {p.tiered_offer && (
                <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Tiered Discount</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{p.tiered_offer}</div>
                </div>
              )}

              {(p.headline || p.body_copy || p.supporting_message) && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {p.headline && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Hero Headline</div>
                      <div style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 700 }}>{p.headline}</div>
                    </div>
                  )}
                  {p.body_copy && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Body Copy</div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{p.body_copy}</div>
                    </div>
                  )}
                  {p.supporting_message && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Supporting Message</div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{p.supporting_message}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Deliverables */}
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 20, color: 'var(--text-primary)' }}>Deliverables</h3>
              <form action={updateProjectDeliverable}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="brand_id" value={brandId} />
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="lp_url">Landing page URL</label>
                  <input
                    id="lp_url"
                    name="lp_url"
                    type="url"
                    defaultValue={p.lp_url ?? ''}
                    placeholder="https://…"
                    disabled={!isAuthorized}
                  />
                  {p.lp_url && (
                    <a href={p.lp_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: 13, color: 'var(--accent)' }}>
                      Open landing page ↗
                    </a>
                  )}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="creatives_notes">Creatives link / notes</label>
                  <textarea
                    id="creatives_notes"
                    name="creatives_notes"
                    rows={3}
                    defaultValue={p.creatives_notes ?? ''}
                    placeholder="Drive link, Figma link, or delivery notes…"
                    style={{ resize: 'vertical' }}
                    disabled={!isAuthorized}
                  />
                </div>
                {isAuthorized && (
                  <button type="submit" className="btn-secondary" style={{ fontSize: 13 }}>
                    Save deliverables
                  </button>
                )}
              </form>

              {/* Share with client */}
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Client Review Link
                </div>
                {isAuthorized ? (
                  <ShareButton projectId={projectId} initialToken={p.share_token} />
                ) : p.share_token ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>A review link has been generated for this project.</p>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No review link yet.</p>
                )}
              </div>
            </div>

            {/* Product images */}
            {imgs.length > 0 && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: 'var(--text-primary)' }}>
                  Product Images ({imgs.length})
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                  {imgs.map((img, i) => (
                    <a key={img.id} href={img.storage_url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.storage_url}
                        alt={`Product ${i + 1}`}
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column — stage trackers */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 76 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              Progress Tracking
            </h3>
            <StageTracker
              projectId={projectId}
              brandId={brandId}
              track="lp_stage"
              currentStage={p.lp_stage}
              label="Landing Page"
              disabled={p.is_complete || !isAuthorized}
            />
            <StageTracker
              projectId={projectId}
              brandId={brandId}
              track="creatives_stage"
              currentStage={p.creatives_stage}
              label="Creatives / Statics"
              disabled={p.is_complete || !isAuthorized}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── TrackSteps ──────────────────────────────────────────────────────────────

const TRACK_STEPS: Array<{ key: Stage; label: string }> = [
  { key: 'brief',       label: 'Brief\nReceived'  },
  { key: 'in_progress', label: 'In\nProduction'   },
  { key: 'review',      label: 'Under\nReview'    },
  { key: 'done',        label: 'Delivered'        },
]

function TrackSteps({ label, stage }: { label: string; stage: Stage }) {
  const idx = TRACK_STEPS.findIndex(s => s.key === stage)

  // Build a flat array of dots + connector lines to avoid Fragment+key headaches
  const nodes: React.ReactNode[] = []
  TRACK_STEPS.forEach((step, i) => {
    const complete = i < idx || (i === idx && stage === 'done')
    const current  = i === idx && stage !== 'done'
    const dotBg     = complete ? 'var(--success)' : current ? 'var(--accent)' : 'transparent'
    const dotBorder = complete ? 'var(--success)' : current ? 'var(--accent)' : 'var(--border)'

    nodes.push(
      <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: dotBg,
          border: `2px solid ${dotBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: complete || current ? 'white' : 'var(--text-muted)',
          fontSize: 11, fontWeight: 700,
        }}>
          {complete ? '✓' : i + 1}
        </div>
        <div style={{
          fontSize: 10, marginTop: 5, textAlign: 'center', lineHeight: 1.3, maxWidth: 52,
          color: complete ? 'var(--success)' : current ? 'var(--accent)' : 'var(--text-muted)',
          fontWeight: current || complete ? 600 : 400,
          whiteSpace: 'pre-line',
        }}>
          {step.label}
        </div>
      </div>
    )
    if (i < TRACK_STEPS.length - 1) {
      nodes.push(
        <div key={`line-${i}`} style={{
          flex: 1, height: 2, marginBottom: 22,
          background: i < idx ? 'var(--success)' : 'var(--border)',
        }} />
      )
    }
  })

  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {nodes}
      </div>
    </div>
  )
}
