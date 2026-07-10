import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StageTracker from '@/components/StageTracker'
import { markProjectComplete, updateProjectDeliverable, deleteProject, lockProjectOffer, unlockProjectOffer } from '@/lib/actions'
import CreativeAssetsManager from '@/components/CreativeAssetsManager'
import { canEdit } from '@/lib/permissions'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import ShareButton from '@/components/ShareButton'
import RevisionsToggle from '@/components/RevisionsToggle'
import NotesThread from '@/components/NotesThread'
import type { Project, Brand, ProjectImage, Journey, CreativeAsset, ProjectComment } from '@/lib/types'
import { calcDaysUntil, isProjectOverdue, overallProgress, parseDueDate } from '@/lib/stageColors'
import ProjectEditForm from '@/components/ProjectEditForm'
import OpenEditFormButton from '@/components/OpenEditFormButton'

// AI revision/edit Server Actions (gpt-image-2) run ~60-90s. Without this they hit
// Vercel's default function timeout and the client gets "unexpected response from
// the server". Page-level maxDuration covers all Server Actions used on this page.
export const maxDuration = 300

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

  // This page only renders the brand's name in the breadcrumb; no need to pull
  // onboarding_transcript / brand_notes / client_token / etc.
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', brandId)
    .single()

  const [{ data: images }, { data: creativeAssetsRaw }, { data: imageCommentsRaw }, { data: notesRaw }, { data: brandJourneysRaw }] = await Promise.all([
    supabase.from('project_images').select('id, storage_url').eq('project_id', projectId),
    supabase.from('creative_assets').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('project_comments').select('*').eq('project_id', projectId).eq('track', 'image').order('created_at'),
    supabase.from('project_comments').select('*').eq('project_id', projectId).eq('track', 'note').order('created_at'),
    supabase.from('journeys').select('*').eq('brand_id', brandId).order('created_at', { ascending: true }),
  ])

  const p = project as Project
  const b = brand as Brand
  const imgs = (images ?? []) as ProjectImage[]
  const creativeAssets = (creativeAssetsRaw ?? []) as CreativeAsset[]
  const imageComments = (imageCommentsRaw ?? []) as ProjectComment[]
  const notes = (notesRaw ?? []) as ProjectComment[]
  const brandJourneys = (brandJourneysRaw ?? []) as Journey[]
  const isAuthorized = canEdit(user?.email)
  const userDisplayName = user?.email?.split('@')[0] ?? 'Team'

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

  const due = parseDueDate(p.due_date)
  const daysUntil = calcDaysUntil(p.due_date)
  const isOverdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

  const bothDone = p.lp_stage === 'done' && p.creatives_stage === 'done'
  const overallPct = overallProgress(p.lp_stage, p.creatives_stage)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 32px 40px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, flexWrap: 'wrap' }}>
          <Link href="/brands" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Brands</Link>
          <span style={{ opacity: 0.5 }}>/</span>
          <Link href={`/brands/${brandId}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            {b?.name ?? 'Brand'}
          </Link>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
        </div>

        {/* ── HERO: Project Status ── */}
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
        }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  {p.name}
                </h1>
                {p.needs_revisions && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', padding: '2px 8px', borderRadius: 20 }}>
                    ↩ Revisions
                  </span>
                )}
                {p.is_complete && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--stage-done-text)', background: 'var(--stage-done-bg)', border: '1px solid color-mix(in srgb, #10B981 30%, transparent)', padding: '2px 8px', borderRadius: 20 }}>
                    ✓ Complete
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                {journey && (
                  <span>🗓 {journey.name}{p.marketing_moment ? ` · Moment ${p.marketing_moment}` : ''}</span>
                )}
                {p.page_type && (
                  <span style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                    {p.page_type}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Due</div>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: isOverdue ? 'var(--urgent-overdue)' : 'var(--text-primary)',
                }}>
                  {isOverdue && '⚠ '}{dueStr}
                </div>
                {daysUntil !== null && !p.is_complete && (
                  <div style={{ fontSize: 11, color: isOverdue ? 'var(--urgent-overdue)' : daysUntil <= 4 ? 'var(--urgent-soon)' : 'var(--text-muted)', marginTop: 2 }}>
                    {isOverdue
                      ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} overdue`
                      : daysUntil === 0
                        ? 'Due today'
                        : `${daysUntil} day${daysUntil === 1 ? '' : 's'} left`}
                  </div>
                )}
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
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}>
                    Delete
                  </button>
                </ConfirmDeleteForm>
              )}
            </div>
          </div>

          {/* Overall progress meter — small */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${overallPct}%`,
                background: overallPct === 100 ? 'var(--stage-done)' : 'var(--accent)',
                transition: 'width 0.4s ease',
              }} />
            </div>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              color: overallPct === 100 ? 'var(--stage-done-text)' : 'var(--text-primary)',
              minWidth: 40,
              textAlign: 'right',
            }}>
              {overallPct}%
            </span>
          </div>

          {/* ── Stage trackers — DOMINANT ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

          {/* Hairline */}
          <div style={{ height: 1, background: 'var(--border)', margin: '20px 0 14px' }} />

          {/* Client status bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <StatusItem
              tone={p.lp_approved ? 'ok' : 'muted'}
              label={p.lp_approved ? '✓ LP approved' : '○ LP: not yet reviewed'}
            />
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <StatusItem
              tone={p.creatives_approved ? 'ok' : 'muted'}
              label={p.creatives_approved ? '✓ Creatives approved' : '○ Creatives: pending'}
            />
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <StatusItem
              tone={p.offer_locked ? 'ok' : 'muted'}
              label={p.offer_locked ? '🔒 Offer locked' : '○ Offer not confirmed'}
            />
          </div>

          {/* Mark complete banner */}
          {!p.is_complete && bothDone && isAuthorized && (
            <div style={{
              marginTop: 18,
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 10,
              padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--stage-done-text)', marginBottom: 2 }}>
                  Both tracks are done
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Mark complete to archive and surface deliverables.
                </div>
              </div>
              <form action={markProjectComplete.bind(null, projectId, brandId)}>
                <button type="submit" style={{
                  background: 'var(--stage-done)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}>
                  ✓ Mark project complete
                </button>
              </form>
            </div>
          )}

          {p.is_complete && (
            <div style={{
              marginTop: 18,
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 10,
              padding: '12px 16px',
              fontSize: 13,
              color: 'var(--stage-done-text)',
              fontWeight: 600,
            }}>
              🎉 Project complete — all deliverables are below.
            </div>
          )}
        </div>

        {/* Inline edit form — only for authorized, active projects */}
        {isAuthorized && !p.is_complete && (
          <ProjectEditForm
            projectId={projectId}
            brandId={brandId}
            journeys={brandJourneys}
            initial={{
              name: p.name,
              due_date: p.due_date,
              stage_brief_due_date: p.stage_brief_due_date,
              stage_in_progress_due_date: p.stage_in_progress_due_date,
              stage_internal_review_due_date: p.stage_internal_review_due_date,
              stage_client_review_due_date: p.stage_client_review_due_date,
              offer_description: p.offer_description,
              offer: p.offer,
              cta: p.cta,
              headline: p.headline,
              body_copy: p.body_copy,
              supporting_message: p.supporting_message,
              journey_id: p.journey_id,
              marketing_moment: p.marketing_moment,
              page_type: p.page_type,
              product_featured: p.product_featured,
              product_description: p.product_description,
              retail_price: p.retail_price,
              offer_dynamics_type: p.offer_dynamics_type,
              competitor_reference: p.competitor_reference,
              client_ad_inspiration: p.client_ad_inspiration,
              ad_copy_primary_text: p.ad_copy_primary_text,
              ad_copy_description: p.ad_copy_description,
              ad_copy_url: p.ad_copy_url,
              ad_headlines: p.ad_headlines,
              ad_subcopies: p.ad_subcopies,
              ad_eyebrows: p.ad_eyebrows,
              product_images_link: p.product_images_link,
              lp_url: p.lp_url,
              creatives_notes: p.creatives_notes,
              shopify_coupon_code: p.shopify_coupon_code,
            }}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Copy & Offer</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {p.offer_locked ? (
                    <>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        🔒 Offer Locked
                        {p.offer_locked_by && (
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                            by {p.offer_locked_by === 'client' ? 'client' : p.offer_locked_by}
                          </span>
                        )}
                      </span>
                      {isAuthorized && (
                        <form action={unlockProjectOffer.bind(null, projectId, brandId)}>
                          <button type="submit" style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                            Unlock
                          </button>
                        </form>
                      )}
                    </>
                  ) : isAuthorized ? (
                    <>
                      <OpenEditFormButton />
                      <form action={lockProjectOffer.bind(null, projectId, brandId)}>
                        <button type="submit" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>
                          🔒 Lock Offer
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </div>

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
                  <label htmlFor="shopify_coupon_code">
                    Shopify coupon code{' '}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      added before LP goes live
                    </span>
                  </label>
                  <input
                    id="shopify_coupon_code"
                    name="shopify_coupon_code"
                    type="text"
                    defaultValue={p.shopify_coupon_code ?? ''}
                    placeholder="e.g. SUMMER20"
                    disabled={!isAuthorized}
                    style={{ textTransform: 'uppercase' }}
                  />
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

              {/* Creative assets (Drive images) */}
              {isAuthorized && (
                <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Creative Assets
                    </div>
                    {creativeAssets.length > 0 && (
                      <Link
                        href={`/brands/${brandId}/projects/${projectId}/internal-review`}
                        style={{
                          fontSize: 12, fontWeight: 600, color: 'white',
                          background: 'var(--accent)', padding: '6px 12px', borderRadius: 7,
                          textDecoration: 'none', whiteSpace: 'nowrap',
                        }}
                      >
                        Open internal review →
                      </Link>
                    )}
                  </div>
                  <CreativeAssetsManager
                    projectId={projectId}
                    brandId={brandId}
                    initialFolderUrl={p.drive_folder_url}
                    initialAssets={creativeAssets}
                    imageComments={imageComments}
                  />
                </div>
              )}

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

            {/* Notes thread */}
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: 'var(--text-primary)' }}>Notes</h3>
              <NotesThread
                notes={notes}
                mode="internal"
                projectId={projectId}
                brandId={brandId}
                currentUserName={userDisplayName}
              />
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
                        loading="lazy"
                        decoding="async"
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
        </div>
      </main>
    </div>
  )
}

function StatusItem({ tone, label }: { tone: 'ok' | 'muted'; label: string }) {
  const color = tone === 'ok' ? 'var(--client-approved)' : 'var(--text-muted)'
  return (
    <span style={{ color, fontWeight: tone === 'ok' ? 600 : 400 }}>{label}</span>
  )
}
