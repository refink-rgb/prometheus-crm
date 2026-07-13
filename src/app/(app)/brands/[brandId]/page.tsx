import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { updateBrandDetails, deleteBrand } from '@/lib/actions'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import ProfitEngineerSelect from '@/components/ProfitEngineerSelect'
import ClientPortalButton from '@/components/ClientPortalButton'
import OnboardingTranscriptField from '@/components/OnboardingTranscriptField'
import type { Brand, Project, Journey, PipelineStatus, BrandDna } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER } from '@/lib/types'
import JourneyHeader from '@/components/JourneyHeader'
import ProjectCard from '@/components/ProjectCard'
import BrandDnaPanel from '@/components/BrandDnaPanel'

// Two-step Gemini research + synthesis for Brand DNA can run 30-90s. Vercel's
// default function timeout would cut it off — mirror the pattern used on the
// project pages for the AI image-edit flows.
export const maxDuration = 120

export default async function BrandPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  const isAuthorized = canEdit(user?.email)

  const { data: brand } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  // Brand page renders ProjectCard for each row and reads only these fields.
  // The big JSON copy columns (ad_headlines/ad_subcopies/ad_eyebrows/body_copy)
  // and the full ad-brief fields belong to the project detail page, not here.
  const [{ data: projects }, { data: peRows }, { data: journeyRows }, { data: dnaRow }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, brand_id, due_date, is_complete, journey_id, marketing_moment, lp_stage, creatives_stage, lp_approved, creatives_approved, share_token')
      .eq('brand_id', brandId)
      .order('due_date', { ascending: true }),
    supabase.from('profit_engineers').select('name').order('name', { ascending: true }),
    supabase.from('journeys').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }),
    supabase.from('brand_dna').select('*').eq('brand_id', brandId).eq('is_active', true).maybeSingle(),
  ])

  const b = brand as Brand
  const allProjects = (projects ?? []) as Project[]
  const engineerNames = (peRows ?? []).map((r: { name: string }) => r.name)
  const journeys = (journeyRows ?? []) as Journey[]
  const dna = (dnaRow ?? null) as BrandDna | null

  const active = allProjects.filter(p => !p.is_complete)
  const done = allProjects.filter(p => p.is_complete)

  // Group active projects by journey
  const journeyMap = new Map<string, Journey>()
  journeys.forEach(j => journeyMap.set(j.id, j))

  const projectsByJourney = new Map<string | null, Project[]>()
  active.forEach(p => {
    const key = p.journey_id ?? null
    if (!projectsByJourney.has(key)) projectsByJourney.set(key, [])
    projectsByJourney.get(key)!.push(p)
  })

  // Sort: journeys that have projects first (most recent journey at top), ungrouped last
  const journeyGroups: Array<{ journey: Journey | null; projects: Project[] }> = []
  journeys.forEach(j => {
    const ps = projectsByJourney.get(j.id)
    if (ps && ps.length > 0) journeyGroups.push({ journey: j, projects: ps })
  })
  const ungrouped = projectsByJourney.get(null)
  if (ungrouped && ungrouped.length > 0) journeyGroups.push({ journey: null, projects: ungrouped })

  const clientNumStr = b.client_number != null
    ? `#${String(b.client_number).padStart(3, '0')}`
    : null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 32px 40px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          <Link href="/brands" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Brands</Link>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--text-primary)' }}>{b.name}</span>
        </div>

        {/* Brand header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 40, gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: `hsl(${b.name.charCodeAt(0) * 7 % 360}, 60%, 25%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 24,
              color: 'white',
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              {b.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                  {b.name}
                </h1>
                {clientNumStr && (
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                    background: 'var(--surface-raised)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '2px 8px',
                  }}>
                    {clientNumStr}
                  </span>
                )}
                <BDStageBadge status={b.pipeline_status} />
              </div>
              <a
                href={b.website}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
              >
                {b.website} ↗
              </a>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {isAuthorized && (
              <ConfirmDeleteForm
                action={deleteBrand.bind(null, brandId)}
                message={`Delete "${b.name}" and all its projects? This cannot be undone.`}
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
                  Delete brand
                </button>
              </ConfirmDeleteForm>
            )}
            <Link href={`/brands/${brandId}/projects/new`} className="btn-primary">
              + New Project
            </Link>
          </div>
        </div>

        {/* Account Details — Roberto + Lucas only */}
        {isAuthorized && (
          <div className="card" style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
              Account Details
            </h2>
            <form action={updateBrandDetails}>
              <input type="hidden" name="brand_id" value={brandId} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20, marginBottom: 20 }}>
                <div>
                  <label>Monthly Retainer ($)</label>
                  <input
                    name="monthly_retainer"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={b.monthly_retainer ?? ''}
                    placeholder="e.g. 5000"
                  />
                </div>
                <div>
                  <label>Start Date</label>
                  <input
                    name="start_date"
                    type="date"
                    defaultValue={b.start_date ?? ''}
                  />
                </div>
                <div>
                  <label>Profit Engineer</label>
                  <ProfitEngineerSelect
                    engineers={engineerNames}
                    current={b.profit_engineer}
                  />
                </div>
                <div>
                  <label>Account Created</label>
                  <div style={{
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 14,
                    color: 'var(--text-muted)',
                  }}>
                    {new Date(b.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>

              {/* BD Pipeline Status */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  BD Pipeline Stage
                </label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PIPELINE_STATUS_ORDER.map((status, i) => {
                    const isActive = b.pipeline_status === status
                    const colors: Record<string, string> = {
                      intro_contact: 'var(--text-muted)',
                      discovery_call: '#60a5fa',
                      offer_prep: 'var(--warning)',
                      active: 'var(--success)',
                    }
                    const color = colors[status]
                    return (
                      <label key={status} style={{
                        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                        border: `1px solid ${isActive ? color : 'var(--border)'}`,
                        background: isActive ? `color-mix(in srgb, ${color} 15%, transparent)` : 'transparent',
                        color: isActive ? color : 'var(--text-muted)',
                        letterSpacing: 0, textTransform: 'none', marginBottom: 0,
                      }}>
                        <input type="radio" name="pipeline_status" value={status} defaultChecked={isActive} style={{ width: 'auto', padding: 0 }} />
                        {i + 1}. {PIPELINE_STATUS_LABELS[status]}
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Client status — single 3-way toggle */}
              {(() => {
                const currentStatus = b.is_trial ? 'trial' : b.is_active ? 'active' : 'inactive'
                const options = [
                  { value: 'active',   label: 'Active',    color: 'var(--success)' },
                  { value: 'inactive', label: 'Inactive',  color: 'var(--danger)'  },
                  { value: 'trial',    label: 'On Trial',  color: 'var(--warning)' },
                ]
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '10px 16px', background: 'var(--surface-raised)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>Billing status</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {options.map(opt => (
                        <label key={opt.value} style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          cursor: 'pointer', textTransform: 'none', letterSpacing: 0,
                          fontSize: 12, fontWeight: 500, marginBottom: 0,
                          padding: '5px 10px', borderRadius: 6,
                          background: currentStatus === opt.value ? `color-mix(in srgb, ${opt.color} 15%, transparent)` : 'transparent',
                          border: `1px solid ${currentStatus === opt.value ? opt.color : 'transparent'}`,
                          color: currentStatus === opt.value ? opt.color : 'var(--text-muted)',
                        }}>
                          <input type="radio" name="client_status" value={opt.value} defaultChecked={currentStatus === opt.value} style={{ width: 'auto', padding: 0 }} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Brand notes */}
              <div style={{ marginBottom: 20 }}>
                <label>Account Notes</label>
                <textarea
                  name="brand_notes"
                  rows={3}
                  defaultValue={b.brand_notes ?? ''}
                  placeholder="General account context, strategy notes, things to keep in mind…"
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Onboarding meeting transcript */}
              <div style={{ marginBottom: 20 }}>
                <OnboardingTranscriptField initialValue={b.onboarding_transcript ?? null} />
              </div>

              <button type="submit" className="btn-secondary" style={{ fontSize: 13 }}>
                Save account details
              </button>
            </form>

            {/* Client Portal */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Client Portal Link
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                Share this link with your client — they can see all their projects, stages, and review deliverables.
              </p>
              <ClientPortalButton brandId={brandId} initialToken={b.client_token ?? null} />
            </div>
          </div>
        )}

        {isAuthorized && (
          <BrandDnaPanel brandId={brandId} dna={dna} />
        )}

        {/* Show brand notes (read-only) for non-editors */}
        {!isAuthorized && b.brand_notes && (
          <div className="card" style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              Account Notes
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{b.brand_notes}</p>
          </div>
        )}

        {allProjects.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              No projects yet
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
              Create a marketing moment to kick off the Prometheus workflow.
            </p>
            <Link href={`/brands/${brandId}/projects/new`} className="btn-primary">
              + Create first project
            </Link>
          </div>
        )}

        {/* Active projects — grouped by journey */}
        {active.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20 }}>
              Active Projects ({active.length})
            </h2>

            {journeyGroups.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {journeyGroups.map(({ journey, projects: jProjects }) => (
                  <div key={journey?.id ?? 'ungrouped'}>
                    {/* Journey header */}
                    {journey ? (
                      <JourneyHeader
                        journey={journey}
                        brandId={brandId}
                        projectCount={jProjects.length}
                        isAuthorized={isAuthorized}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          background: 'var(--accent-muted)', border: '1px solid rgba(249,115,22,0.2)',
                          borderRadius: 6, padding: '3px 10px',
                        }}>
                          📋 No Journey
                        </div>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {jProjects.length} moment{jProjects.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}

                    {/* Moment 1 then Moment 2 then unassigned */}
                    {[1, 2, null].map(moment => {
                      const momentProjects = moment !== null
                        ? jProjects.filter(p => p.marketing_moment === moment)
                        : jProjects.filter(p => p.marketing_moment === null)
                      if (momentProjects.length === 0) return null
                      const momentLabel = moment === null
                        ? 'No Moment Assigned'
                        : `Moment ${moment} · ${moment === 1 ? '1st half of month' : '2nd half of month'}`
                      return (
                        <div key={String(moment)} style={{ marginBottom: 12 }}>
                          <div style={{
                            fontSize: 10, fontWeight: 600,
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: '0.07em',
                            marginBottom: 8, paddingLeft: 4,
                          }}>
                            {momentLabel}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {momentProjects.map(p => (
                              <ProjectCard
                                key={p.id}
                                project={p}
                                journeyName={journey?.name ?? null}
                                href={`/brands/${brandId}/projects/${p.id}`}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {active.map(p => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    href={`/brands/${brandId}/projects/${p.id}`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {done.length > 0 && (
          <section>
            <h2 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
              Completed ({done.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.6 }}>
              {done.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  href={`/brands/${brandId}/projects/${p.id}`}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

const BD_COLORS: Record<PipelineStatus, string> = {
  intro_contact:  'var(--bd-intro)',
  discovery_call: 'var(--bd-discovery)',
  offer_prep:     'var(--bd-offer)',
  active:         'var(--bd-active)',
}

function BDStageBadge({ status }: { status: PipelineStatus }) {
  const color = BD_COLORS[status]
  return (
    <span style={{
      fontSize: 14,
      fontWeight: 700,
      color,
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      padding: '6px 16px',
      borderRadius: 20,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {PIPELINE_STATUS_LABELS[status]}
    </span>
  )
}
