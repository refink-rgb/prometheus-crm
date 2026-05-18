import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import StageTracker from '@/components/StageTracker'
import { markProjectComplete, updateProjectDeliverable } from '@/lib/actions'
import type { Project, Brand, ProjectImage } from '@/lib/types'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ brandId: string; projectId: string }>
}) {
  const { brandId, projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  const due = p.due_date ? new Date(p.due_date) : null
  const isOverdue = due && due < new Date() && !p.is_complete
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

  const bothDone = p.lp_stage === 'done' && p.creatives_stage === 'done'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <Nav email={user.email} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                {p.name}
              </h1>
              {p.is_complete && <span className="badge badge-done">✓ Complete</span>}
              {!p.is_complete && isOverdue && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '3px 8px', borderRadius: 6 }}>OVERDUE</span>}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              Due: <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: isOverdue ? 600 : 400 }}>{dueStr}</span>
            </p>
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
            {!p.is_complete && bothDone && (
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

            {/* Brief info */}
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 20, color: 'var(--text-primary)' }}>Brief</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { label: 'Offer', value: p.offer },
                  { label: 'Discount', value: p.discount },
                  { label: 'Font', value: p.font },
                  { label: 'Author / Copywriter', value: p.author },
                  { label: 'Assigned Designer', value: p.assigned_designer },
                  { label: 'Call to Action', value: p.cta },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{value}</div>
                  </div>
                ) : null)}
              </div>

              {p.headline && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Headline</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{p.headline}</div>
                </div>
              )}
              {p.body_copy && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Body Copy</div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p.body_copy}</div>
                </div>
              )}
              {p.target_audience && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Target Audience</div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p.target_audience}</div>
                </div>
              )}
              {p.notes && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Notes</div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p.notes}</div>
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
                  />
                </div>
                <button type="submit" className="btn-secondary" style={{ fontSize: 13 }}>
                  Save deliverables
                </button>
              </form>
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
              disabled={p.is_complete}
            />
            <StageTracker
              projectId={projectId}
              brandId={brandId}
              track="creatives_stage"
              currentStage={p.creatives_stage}
              label="Creatives / Statics"
              disabled={p.is_complete}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
