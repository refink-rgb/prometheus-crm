import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import StageTracker from '@/components/StageTracker'
import { markProjectComplete, updateProjectDeliverable, deleteProject, lockProjectOffer, unlockProjectOffer } from '@/lib/actions'
import CreativeAssetsManager from '@/components/CreativeAssetsManager'
import { canEdit } from '@/lib/permissions'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import ShareButton from '@/components/ShareButton'
import RevisionsToggle from '@/components/RevisionsToggle'
import NotesThread from '@/components/NotesThread'
import ClientFeedbackPanel from '@/components/ClientFeedbackPanel'
import type { Project, Brand, ProjectImage, Journey, CreativeAsset, ProjectComment } from '@/lib/types'
import { calcDaysUntil, isProjectOverdue, overallProgress, parseDueDate } from '@/lib/stageColors'
import ProjectEditForm from '@/components/ProjectEditForm'
import OpenEditFormButton from '@/components/OpenEditFormButton'
import CopyDeckPanel from '@/components/CopyDeckPanel'
import EditorPicker from '@/components/EditorPicker'
import Avatar from '@/components/Avatar'
import { getCachedProfiles } from '@/lib/profiles'
import { profileName, editorsFor } from '@/lib/types'
import SubmitButton from '@/components/SubmitButton'

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
  const user = await getCachedUser()

  // Everything below is keyed only by projectId/brandId from the URL, so it
  // can all go out in ONE parallel batch. This used to be a 4-step sequential
  // waterfall (project → brand → batch → journey), each step paying a full
  // round-trip to the database.
  const [
    { data: project },
    { data: brand },
    { data: images },
    { data: creativeAssetsRaw },
    { data: imageCommentsRaw },
    { data: lpFeedbackRaw },
    { data: notesRaw },
    { data: brandJourneysRaw },
    profiles,
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('id', projectId).single(),
    // Breadcrumb only renders the brand's name; no need to pull
    // onboarding_transcript / brand_notes / client_token / etc.
    supabase.from('brands').select('id, name').eq('id', brandId).single(),
    supabase.from('project_images').select('id, storage_url').eq('project_id', projectId),
    supabase.from('creative_assets').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('project_comments').select('*').eq('project_id', projectId).eq('track', 'image').order('created_at'),
    // Landing-page client feedback for the Client Feedback panel (never internal).
    supabase.from('project_comments').select('*').eq('project_id', projectId).in('track', ['lp', 'general']).neq('audience', 'internal').order('created_at'),
    supabase.from('project_comments').select('*').eq('project_id', projectId).eq('track', 'note').order('created_at'),
    supabase.from('journeys').select('*').eq('brand_id', brandId).order('created_at', { ascending: true }),
    getCachedProfiles(),
  ])

  if (!project) notFound()

  const p = project as Project
  const b = brand as Brand
  const imgs = (images ?? []) as ProjectImage[]
  const creativeAssets = (creativeAssetsRaw ?? []) as CreativeAsset[]
  const imageComments = (imageCommentsRaw ?? []) as ProjectComment[]
  const lpFeedback = (lpFeedbackRaw ?? []) as ProjectComment[]
  // Creative feedback the client actually left (exclude internal image notes).
  const creativeFeedback = imageComments.filter(c => c.audience !== 'internal')
  const notes = (notesRaw ?? []) as ProjectComment[]
  const brandJourneys = (brandJourneysRaw ?? []) as Journey[]
  const isAuthorized = canEdit(user?.email)
  const userDisplayName = user?.email?.split('@')[0] ?? 'Team'

  const lpEditor = profiles.find(x => x.id === p.lp_editor_id) ?? null
  const creativeEditor = profiles.find(x => x.id === p.creative_editor_id) ?? null

  // The project's journey (if any) belongs to this brand, and we already
  // fetched every journey for the brand above — no extra query needed.
  const journey: Journey | null = p.journey_id
    ? brandJourneys.find(j => j.id === p.journey_id) ?? null
    : null

  const due = parseDueDate(p.due_date)
  const daysUntil = calcDaysUntil(p.due_date)
  const isOverdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
  const dueStr = due ? due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

  const bothDone = p.lp_stage === 'done' && p.creatives_stage === 'done'
  const overallPct = overallProgress(p.lp_stage, p.creatives_stage)

  // Per-stage planning targets (informational). Live = the launch due_date.
  const stageTimeline = [
    { label: 'Brief', value: fmtStageDate(p.stage_brief_due_date) },
    { label: 'In Progress', value: fmtStageDate(p.stage_in_progress_due_date) },
    { label: 'Internal Review', value: fmtStageDate(p.stage_internal_review_due_date) },
    { label: 'Client Review', value: fmtStageDate(p.stage_client_review_due_date) },
    { label: 'Live', value: fmtStageDate(p.due_date) },
  ]
  const hasTimeline = stageTimeline.some(s => s.value)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 32px 40px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
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
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
        }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  {p.name}
                </h1>
                {p.needs_revisions && (
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--warning)', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', padding: '2px 8px', borderRadius: 20 }}>
                    ↩ Revisions
                  </span>
                )}
                {p.is_complete && (
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--stage-done-text)', background: 'var(--stage-done-bg)', border: '1px solid color-mix(in srgb, #10B981 30%, transparent)', padding: '2px 8px', borderRadius: 20 }}>
                    ✓ Complete
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
                {journey && (
                  <span>🗓 {journey.name}{p.marketing_moment ? ` · Moment ${p.marketing_moment}` : ''}</span>
                )}
                {p.page_type && (
                  <span style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                    {p.page_type}
                  </span>
                )}
                {lpEditor && (
                  <span title={`LP Editor: ${profileName(lpEditor)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'color-mix(in srgb, var(--editor-lp) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--editor-lp) 25%, transparent)', borderRadius: 6, padding: '2px 8px', color: 'var(--editor-lp)', fontWeight: 500 }}>
                    LP · {profileName(lpEditor)}
                  </span>
                )}
                {creativeEditor && (
                  <span title={`Creative Editor: ${profileName(creativeEditor)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'color-mix(in srgb, var(--editor-creative) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--editor-creative) 25%, transparent)', borderRadius: 6, padding: '2px 8px', color: 'var(--editor-creative)', fontWeight: 500 }}>
                    CR · {profileName(creativeEditor)}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Due</div>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: isOverdue ? 'var(--urgent-overdue)' : 'var(--text-primary)',
                }}>
                  {isOverdue && '⚠ '}{dueStr}
                </div>
                {daysUntil !== null && !p.is_complete && (
                  <div style={{ fontSize: 'var(--text-xs)', color: isOverdue ? 'var(--urgent-overdue)' : daysUntil <= 4 ? 'var(--urgent-soon)' : 'var(--text-muted)', marginTop: 2 }}>
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
                  <button type="submit" className="btn-danger btn-sm">
                    Delete
                  </button>
                </ConfirmDeleteForm>
              )}
            </div>
          </div>

          {/* Overall progress meter — small */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-1)', marginBottom: 'var(--space-5)' }}>
            <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${overallPct}%`,
                background: overallPct === 100 ? 'var(--stage-done)' : 'var(--accent)',
                transition: 'width 0.4s ease',
              }} />
            </div>
            <span style={{
              fontSize: 'var(--text-base)',
              fontWeight: 700,
              color: overallPct === 100 ? 'var(--stage-done-text)' : 'var(--text-primary)',
              minWidth: 40,
              textAlign: 'right',
            }}>
              {overallPct}%
            </span>
          </div>

          {/* ── Stage trackers — DOMINANT ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
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
              marginTop: 'var(--space-5)',
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 10,
              padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--stage-done-text)', marginBottom: 2 }}>
                  Both tracks are done
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  Mark complete to archive and surface deliverables.
                </div>
              </div>
              <form action={markProjectComplete.bind(null, projectId, brandId)}>
                <SubmitButton
                  pendingText="Marking complete…"
                  style={{
                    background: 'var(--stage-done)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontSize: 'var(--text-base)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  ✓ Mark project complete
                </SubmitButton>
              </form>
            </div>
          )}

          {p.is_complete && (
            <div style={{
              marginTop: 'var(--space-5)',
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 10,
              padding: '12px 16px',
              fontSize: 'var(--text-base)',
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
            profiles={profiles}
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
              lp_editor_id: p.lp_editor_id,
              creative_editor_id: p.creative_editor_id,
            }}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

            {/* Stage timeline — per-phase planning targets */}
            {hasTimeline && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)', color: 'var(--text-primary)' }}>Stage Timeline</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)' }}>
                  {stageTimeline.map(s => (
                    <div key={s.label}>
                      <div style={microLabel}>{s.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: s.value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{s.value ?? '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Meta — assignment + product + revisions */}
            {(p.product_featured || isAuthorized) && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)', color: 'var(--text-primary)' }}>Project Info</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {isAuthorized ? (
                    <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>LP Editor</div>
                        <EditorPicker
                          mode="instant"
                          track="lp"
                          options={editorsFor(profiles, 'is_lp_editor')}
                          current={p.lp_editor_id}
                          projectId={projectId}
                          brandId={brandId}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>Creative Editor</div>
                        <EditorPicker
                          mode="instant"
                          track="creative"
                          options={editorsFor(profiles, 'is_creative_editor')}
                          current={p.creative_editor_id}
                          projectId={projectId}
                          brandId={brandId}
                        />
                      </div>
                    </div>
                  ) : (lpEditor || creativeEditor) && (
                    <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
                      {lpEditor && (
                        <div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>LP Editor</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Avatar name={profileName(lpEditor)} size={22} />
                            <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{profileName(lpEditor)}</span>
                          </div>
                        </div>
                      )}
                      {creativeEditor && (
                        <div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>Creative Editor</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Avatar name={profileName(creativeEditor)} size={22} />
                            <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{profileName(creativeEditor)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {p.product_featured && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Product Featured</div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>📦 {p.product_featured}</div>
                    </div>
                  )}
                  <Detail label="Product Description" value={p.product_description} pre />
                  <Detail label="Retail Price / Value" value={p.retail_price} />
                  <Detail label="Product Images Link" value={p.product_images_link} href />
                  {journey && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Journey</div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                        🗓 {journey.name}
                        {p.marketing_moment && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· Moment {p.marketing_moment} ({p.marketing_moment === 1 ? '1st half' : '2nd half'} of month)</span>}
                      </div>
                    </div>
                  )}
                  {isAuthorized && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>Revision Flag</div>
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
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)', color: 'var(--text-primary)' }}>Offer Description</h3>
                {p.offer_description && (
                  <div style={{ marginBottom: p.inspiration ? 16 : 0 }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Overview</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{p.offer_description}</div>
                  </div>
                )}
                {p.inspiration && (
                  <div style={{ paddingTop: p.offer_description ? 16 : 0, borderTop: p.offer_description ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Inspiration</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{p.inspiration}</div>
                  </div>
                )}
              </div>
            )}

            {/* Copy & Offer */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>Copy & Offer</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  {p.offer_locked ? (
                    <>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                        🔒 Offer Locked
                        {p.offer_locked_by && (
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                            by {p.offer_locked_by === 'client' ? 'client' : p.offer_locked_by}
                          </span>
                        )}
                      </span>
                      {isAuthorized && (
                        <form action={unlockProjectOffer.bind(null, projectId, brandId)}>
                          <SubmitButton pendingText="Unlocking…" className="btn-secondary btn-sm">
                            Unlock
                          </SubmitButton>
                        </form>
                      )}
                    </>
                  ) : isAuthorized ? (
                    <>
                      <OpenEditFormButton />
                      <form action={lockProjectOffer.bind(null, projectId, brandId)}>
                        <SubmitButton pendingText="Locking…" className="btn-accent-outline btn-sm">
                          🔒 Lock Offer
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Offer pills */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                {[
                  { label: 'Offer Type', value: p.offer_dynamics_type },
                  { label: 'Offer / Promo', value: p.offer },
                  { label: 'Discount', value: p.discount },
                  { label: 'CTA', value: p.cta },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>{label}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{value}</div>
                  </div>
                ) : null)}
              </div>

              {p.tiered_offer && (
                <div style={{ marginBottom: 'var(--space-4)', padding: '12px 14px', background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>Tiered Discount</div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{p.tiered_offer}</div>
                </div>
              )}

              {(p.headline || p.body_copy || p.supporting_message) && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {p.headline && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Hero Headline</div>
                      <div style={{ fontSize: 'var(--text-md)', color: 'var(--text-primary)', fontWeight: 700 }}>{p.headline}</div>
                    </div>
                  )}
                  {p.body_copy && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Body Copy</div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{p.body_copy}</div>
                    </div>
                  )}
                  {p.supporting_message && (
                    <div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)' }}>Supporting Message</div>
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{p.supporting_message}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Copy Deck */}
            <CopyDeckPanel
              projectId={projectId}
              brandId={brandId}
              initialHeadlines={p.ad_headlines ?? []}
              initialEyebrows={p.ad_eyebrows ?? []}
              initialSubcopies={p.ad_subcopies ?? []}
            />

            {/* Creative Brief — direction + Meta ad copy */}
            {(p.competitor_reference || p.client_ad_inspiration || p.ad_copy_primary_text || p.ad_copy_description || p.ad_copy_url) && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)', color: 'var(--text-primary)' }}>Creative Brief</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <Detail label="Competitor Reference" value={p.competitor_reference} pre />
                  <Detail label="Client Ad Inspiration" value={p.client_ad_inspiration} pre />
                  {(p.ad_copy_primary_text || p.ad_copy_description || p.ad_copy_url) && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Meta Ad Copy</div>
                      <Detail label="Primary Text" value={p.ad_copy_primary_text} pre />
                      <Detail label="Description" value={p.ad_copy_description} />
                      <Detail label="URL" value={p.ad_copy_url} href />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Deliverables */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--text-primary)', margin: 0 }}>Deliverables</h3>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', letterSpacing: '0.04em' }}>
                  4×5
                </span>
              </div>
              <form action={updateProjectDeliverable}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="brand_id" value={brandId} />
                <div style={{ marginBottom: 'var(--space-4)' }}>
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
                    <a href={p.lp_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 'var(--space-2)', fontSize: 'var(--text-base)', color: 'var(--accent)' }}>
                      Open landing page ↗
                    </a>
                  )}
                </div>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="motion_link">
                    Motion link{' '}
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      videos for the editors
                    </span>
                  </label>
                  <input
                    id="motion_link"
                    name="motion_link"
                    type="url"
                    defaultValue={p.motion_link ?? ''}
                    placeholder="https://app.motionapp.com/…"
                    disabled={!isAuthorized}
                  />
                  {p.motion_link && (
                    <a href={p.motion_link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 'var(--space-2)', fontSize: 'var(--text-base)', color: 'var(--accent)' }}>
                      Open videos in Motion ↗
                    </a>
                  )}
                </div>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label htmlFor="shopify_coupon_code">
                    Shopify coupon code{' '}
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
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
                <div style={{ marginBottom: 'var(--space-4)' }}>
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
                  <SubmitButton pendingText="Saving…" className="btn-accent-outline" style={{ fontSize: 'var(--text-base)' }}>
                    Save deliverables
                  </SubmitButton>
                )}
              </form>

              {/* Creative assets (Drive images) */}
              {isAuthorized && (
                <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', gap: 'var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Creative Assets
                    </div>
                    {creativeAssets.length > 0 && (
                      <Link
                        href={`/brands/${brandId}/projects/${projectId}/internal-review`}
                        style={{
                          fontSize: 'var(--text-sm)', fontWeight: 600, color: 'white',
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
              <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-3)' }}>
                  Client Review Link
                </div>
                {isAuthorized ? (
                  <ShareButton projectId={projectId} initialToken={p.share_token} />
                ) : p.share_token ? (
                  <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>A review link has been generated for this project.</p>
                ) : (
                  <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>No review link yet.</p>
                )}
              </div>
            </div>

            {/* Client feedback — everything the client left on the review link.
                The notification bell links here via #client-feedback. */}
            <ClientFeedbackPanel
              lpFeedback={lpFeedback}
              creativeFeedback={creativeFeedback}
              assets={creativeAssets}
              lpApproved={p.lp_approved}
              creativesApproved={p.creatives_approved}
              projectId={projectId}
              brandId={brandId}
              canResolve={isAuthorized}
            />

            {/* Notes thread */}
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)', color: 'var(--text-primary)' }}>Notes</h3>
              <NotesThread
                notes={notes}
                mode="internal"
                projectId={projectId}
                brandId={brandId}
                currentUserName={userDisplayName}
                canDelete={isAuthorized}
                mentionables={profiles.map(pr => ({ id: pr.id, name: profileName(pr) }))}
              />
            </div>

            {/* Product images */}
            {imgs.length > 0 && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-4)', color: 'var(--text-primary)' }}>
                  Product Images ({imgs.length})
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-3)' }}>
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

const microLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-1)',
}

// Read-only brief field: renders nothing when empty so sparse briefs stay clean.
function Detail({ label, value, pre, href }: { label: string; value?: string | null; pre?: boolean; href?: boolean }) {
  if (!value) return null
  return (
    <div style={{ minWidth: 0 }}>
      <div style={microLabel}>{label}</div>
      {href ? (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: 'var(--accent)', wordBreak: 'break-all' }}>
          {value} ↗
        </a>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: pre ? 'pre-wrap' : 'normal' }}>{value}</div>
      )}
    </div>
  )
}

// 'YYYY-MM-DD' | null → 'Jul 22' | null
function fmtStageDate(s: string | null): string | null {
  const d = parseDueDate(s)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
}
