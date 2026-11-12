import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { updateBrandDetails, deleteBrand } from '@/lib/actions'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import ProfitEngineerSelect from '@/components/ProfitEngineerSelect'
import ClientPortalButton from '@/components/ClientPortalButton'
import type { Brand, Project, Journey, PipelineStatus, BrandDna, BrandDocument, BrandComment } from '@/lib/types'
import { PIPELINE_STATUS_LABELS, PIPELINE_STATUS_ORDER, profileName } from '@/lib/types'
import BrandDnaPanel from '@/components/BrandDnaPanel'
import BrandGuidelines from '@/components/preview/BrandGuidelines'
import BrandDocuments from '@/components/preview/BrandDocuments'
import BrandBrief from '@/components/preview/BrandBrief'
import BrandThread from '@/components/preview/BrandThread'
import BrandContracts from '@/components/brand/BrandContracts'
import ContractFill from '@/components/brand/ContractFill'
import BrandProjects from '@/components/brand/BrandProjects'
import ClientRulesBoard from '@/components/brand/ClientRulesBoard'
import ContactsCard from '@/components/brand/ContactsCard'
import IntakeAnswers from '@/components/brand/IntakeAnswers'
import IntakePanel from '@/components/brand/IntakePanel'
import IntakeReview from '@/components/brand/IntakeReview'
import { intakeCompleteness, intakeSections, intakeText, normalizeIntake } from '@/lib/brands/intake'
import OnboardingCall from '@/components/brand/OnboardingCall'
import { loadContracts, type BrandContract } from '@/lib/bfcm/production-server'
import { dnaSources } from '@/lib/brands/dna-sources'
import { loadRules, type BrandContact, type DocKind } from '@/lib/brands/profile'
import { saveBrandProfileFields } from '@/lib/brands/actions'
import '@/components/brand/brand.css'

// Two-step Gemini research + synthesis for Brand DNA can run 30-90s. Vercel's
// default function timeout would cut it off — mirror the pattern used on the
// project pages for the AI image-edit flows. A build also reads the client's
// guideline files page by page, so this sits at 300 rather than 120.
export const maxDuration = 300

// The brand page is the source of truth for a client. It opens read-only, in
// tabs; account details open for editing behind "Edit details". Tabs are links
// so a tab can be shared and survives a refresh.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'dna', label: 'Brand DNA' },
  { key: 'files', label: 'Files' },
  { key: 'projects', label: 'Projects' },
  { key: 'feedback', label: 'Feedback' },
] as const
type Tab = typeof TABS[number]['key']

const fmtDate = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export default async function BrandPage({
  params, searchParams,
}: {
  params: Promise<{ brandId: string }>
  searchParams: Promise<{ edit?: string; tab?: string }>
}) {
  const [{ brandId }, { edit, tab: tabParam }] = await Promise.all([params, searchParams])
  const supabase = await createClient()
  const user = await getCachedUser()
  const isAuthorized = await canEdit(user?.email)
  const editing = isAuthorized && edit === '1'
  const tab: Tab = TABS.find(t => t.key === tabParam)?.key ?? 'overview'

  const { data: brand } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  // Brand page renders ProjectCard for each row and reads only these fields.
  // The big JSON copy columns (ad_headlines/ad_subcopies/ad_eyebrows/body_copy)
  // and the full ad-brief fields belong to the project detail page, not here.
  const [
    { data: projects }, { data: peRows }, { data: journeyRows }, { data: dnaRow }, { data: docRows },
    { data: contactRows }, { data: commentRows }, { data: offerRows }, rules, contractRows, profiles,
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, brand_id, due_date, is_complete, journey_id, marketing_moment, lp_stage, creatives_stage, lp_approved, creatives_approved, share_token, moment_code, lp_editor_id, creative_editor_id')
      .eq('brand_id', brandId)
      .order('due_date', { ascending: true }),
    supabase.from('profit_engineers').select('name').order('name', { ascending: true }),
    supabase.from('journeys').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }),
    supabase.from('brand_dna').select('*').eq('brand_id', brandId).eq('is_active', true).maybeSingle(),
    supabase.from('brand_documents').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }),
    supabase.from('brand_contacts').select('*').eq('brand_id', brandId).order('sort_order'),
    supabase.from('brand_comments').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }),
    supabase.from('offer_cards').select('assigned_to').eq('brand_id', brandId).not('assigned_to', 'is', null).order('created_at', { ascending: false }).limit(5),
    loadRules(supabase, brandId, { includeRetired: true }),
    loadContracts(brandId),
    getCachedProfiles(),
  ])

  const b = brand as Brand
  const allProjects = (projects ?? []) as Project[]
  const engineerNames = (peRows ?? []).map((r: { name: string }) => r.name)
  const journeys = (journeyRows ?? []) as Journey[]
  const dna = (dnaRow ?? null) as BrandDna | null
  const documents = (docRows ?? []) as BrandDocument[]
  const contacts = (contactRows ?? []) as BrandContact[]
  const brandComments = (commentRows ?? []) as BrandComment[]
  const contracts: BrandContract[] = contractRows ?? []
  const people = Object.fromEntries(profiles.map(p => [p.id, profileName(p)]))
  const projectNames = Object.fromEntries(allProjects.map(p => [p.id, p.name]))

  // A file linked to a contract is a contract, even if it was uploaded elsewhere.
  const contractDocIds = new Set(contracts.map(c => c.document_id).filter(Boolean))
  const kindOf = (d: BrandDocument): DocKind => contractDocIds.has(d.id) ? 'contract' : (d.kind ?? 'other') as DocKind
  const docsOf = (k: DocKind) => documents.filter(d => kindOf(d) === k)
  const hasGuidelines = docsOf('guidelines').length > 0 || !!b.brand_guidelines
  const intakeForm = b.intake_form ? normalizeIntake(b.intake_form) : null
  const intakeItems = intakeCompleteness({
    form: intakeForm,
    docKinds: documents.map(d => kindOf(d)),
    hasGuidelineText: !!b.brand_guidelines?.trim(),
    aiSensitivity: b.ai_sensitivity ?? null,
    contactCount: contacts.length,
    dna,
  })

  // Who works on this account: the named leads, then whoever is on live work.
  const nameOf = (id: string | null | undefined) => (id ? people[id] : null)
  const activeProjects = allProjects.filter(p => !p.is_complete)
  const team = [
    { role: 'Profit engineer', names: b.profit_engineer ? [b.profit_engineer] : [] },
    { role: 'Growth strategist', names: b.growth_strategist ? [b.growth_strategist] : [] },
    { role: 'Offers', names: (offerRows ?? []).map(o => nameOf(o.assigned_to as string | null)) },
    { role: 'Landing pages', names: activeProjects.map(p => nameOf(p.lp_editor_id)) },
    { role: 'Creatives', names: activeProjects.map(p => nameOf(p.creative_editor_id)) },
  ].map(t => ({ role: t.role, names: [...new Set(t.names.filter((n): n is string => !!n))] }))

  const clientNumStr = b.client_number != null ? `#${String(b.client_number).padStart(3, '0')}` : null
  const billing = b.is_trial ? { label: 'On trial', color: 'var(--warning)' } : b.is_active ? { label: 'Active', color: 'var(--success)' } : { label: 'Inactive', color: 'var(--danger)' }

  async function saveDetails(formData: FormData) {
    'use server'
    const r = await saveBrandProfileFields(brandId, {
      name: String(formData.get('name') ?? ''),
      website: String(formData.get('website') ?? ''),
    })
    if (!r.ok) throw new Error(r.error)
    await updateBrandDetails(formData)
    redirect(`/brands/${brandId}`)
  }

  const count: Partial<Record<Tab, number>> = {
    files: documents.length,
    projects: allProjects.length,
    feedback: rules.filter(r => r.status === 'active').length,
  }

  return (
    <div className="mo-page">
      <div>
        <Link href="/brands" className="mo-crumb">← Brands</Link>
      </div>

      {/* Header: who they are and the account at a glance */}
      <header className="mo-panel mo-panel-pad bp-head">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
          {dna?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dna.logo_url} alt="" className="bp-mark" style={{ objectFit: 'contain', background: 'var(--surface-2)', border: '1px solid var(--border)' }} loading="lazy" decoding="async" />
          ) : (
            <div className="bp-mark" style={{ background: `hsl(${b.name.charCodeAt(0) * 7 % 360}, 45%, 38%)` }}>{b.name.charAt(0).toUpperCase()}</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="mo-row" style={{ gap: 10 }}>
              <h1 className="mo-h1">{b.name}</h1>
              {clientNumStr && <span className="mo-pill" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{clientNumStr}</span>}
              {/* One status. Before they sign, where they are in sales; after, whether they are paying. */}
              {b.pipeline_status !== 'active'
                ? <BDStageBadge status={b.pipeline_status} />
                : <span className="mo-pill" style={{ color: billing.color, background: `color-mix(in srgb, ${billing.color} 14%, transparent)` }}>{b.is_trial ? 'On trial' : `${billing.label} client`}</span>}
            </div>
            <div className="bp-facts">
              {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{b.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗</a>}
              {b.start_date && <span>Client since <b>{fmtDate(b.start_date)}</b></span>}
              {b.profit_engineer && <span>Profit engineer <b>{b.profit_engineer}</b></span>}
            </div>
          </div>
        </div>
        <div className="bp-actions">
          {isAuthorized && !editing && <Link href={`/brands/${brandId}?edit=1`} className="btn-secondary" style={{ fontSize: 14 }}>Edit details</Link>}
          <Link href={`/brands/${brandId}/projects/new`} className="btn-primary" style={{ fontSize: 14 }}>+ New project</Link>
        </div>
      </header>

      <nav className="bp-tabs" aria-label="Brand sections">
        {TABS.map(t => (
          <Link key={t.key} href={t.key === 'overview' ? `/brands/${brandId}` : `/brands/${brandId}?tab=${t.key}`} scroll={false} className="bp-tab" aria-current={tab === t.key ? 'page' : undefined}>
            {t.label}{count[t.key] ? <span className="mo-count"> · {count[t.key]}</span> : null}
          </Link>
        ))}
      </nav>

      {editing && (
        <AccountDetailsForm b={b} brandId={brandId} engineerNames={engineerNames} teamNames={profiles.filter(p => p.can_edit).map(profileName)} action={saveDetails} />
      )}

      {tab === 'overview' && (
        <div className="bp-layout">
          <div className="bp-col">
            <IntakePanel
              brandId={brandId}
              brandName={b.name}
              token={b.intake_token ?? null}
              items={intakeItems}
              submittedAt={b.intake_submitted_at ?? null}
              updatedAt={b.intake_updated_at ?? null}
              canEdit={isAuthorized}
            />

            {intakeForm && (
              <IntakeReview
                brandName={b.name}
                sections={intakeSections(intakeForm)}
                text={intakeText(intakeForm)}
                submittedAt={b.intake_submitted_at ?? null}
                updatedAt={b.intake_updated_at ?? null}
              />
            )}

            {/* What was agreed, readable by the whole team */}
            <section className="mo-panel" aria-label="Contract">
              <div className="bp-card-head">
                <div>
                  <h2 className="mo-h2">What we agreed</h2>
                  <p className="bp-purpose">From the signed contract. Scope can differ per client, so check here first.</p>
                </div>
                {isAuthorized && <Link href={`/brands/${brandId}?tab=files`} scroll={false} className="bp-link" style={{ fontSize: 13 }}>Manage</Link>}
              </div>
              <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {contractRows === null && <p className="bp-empty">Contracts are unavailable right now.</p>}
                {contractRows !== null && contracts.length === 0 && <div className="bp-warn">No contract on file. Add the signed SOW under Files.</div>}
                {contracts.map(c => (
                  <div key={c.id} className="bp-contract">
                    <span><b>{c.title}</b>{c.signed_on && <span className="mo-muted"> · {fmtDate(c.signed_on)}</span>}</span>
                    {!c.deliverables && !c.revisions && !c.special_terms && c.document_id && isAuthorized ? (
                      <ContractFill brandId={brandId} documentId={c.document_id} />
                    ) : (
                    <dl className="bp-dl bp-dl-wide">
                      <dt>Deliverables</dt><dd className="bp-pre">{c.deliverables || '—'}</dd>
                      <dt>Revisions</dt><dd className="bp-pre">{c.revisions || '—'}</dd>
                      <dt>Special terms</dt><dd className="bp-pre">{c.special_terms || '—'}</dd>
                    </dl>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Our notes about the client: the pinned summary, then the running thread */}
            {isAuthorized && (
              <section className="mo-panel" aria-label="Internal notes">
                <div className="bp-card-head">
                  <div>
                    <h2 className="mo-h2">Internal notes</h2>
                    <p className="bp-purpose">What the team has learned about {b.name}. Never shown to the client.</p>
                  </div>
                </div>
                <div className="bp-card-body">
                  <BrandBrief
                    key={`${b.brand_notes ?? ''}::${b.ai_sensitivity ?? ''}`}
                    brandId={brandId}
                    brandName={b.name}
                    notes={b.brand_notes ?? null}
                    sensitivity={b.ai_sensitivity ?? null}
                  />
                  <BrandThread
                    brandId={brandId}
                    brandName={b.name}
                    comments={brandComments}
                    currentUserId={user?.id ?? null}
                    embedded
                  />
                </div>
              </section>
            )}
            {!isAuthorized && b.brand_notes && (
              <section className="mo-panel mo-panel-pad" aria-label="Internal notes">
                <h2 className="mo-h2" style={{ marginBottom: 8 }}>Internal notes</h2>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{b.brand_notes}</p>
              </section>
            )}
          </div>

          <aside className="bp-col">
            <ContactsCard
              brandId={brandId}
              contacts={contacts}
              channel={b.preferred_channel ?? null}
              channelDetails={b.channel_details ?? null}
              canEdit={isAuthorized}
            />

            <section className="mo-panel" aria-label="People on this account">
              <div className="bp-card-head">
                <h2 className="mo-h2">Our team</h2>
              </div>
              <div className="bp-card-body">
                <dl className="bp-dl">
                  {team.map(t => <div key={t.role} style={{ display: 'contents' }}><dt>{t.role}</dt><dd>{t.names.join(', ') || '—'}</dd></div>)}
                </dl>
              </div>
            </section>

            {isAuthorized && (
              <section className="mo-panel" aria-label="Account">
                <div className="bp-card-head">
                  <h2 className="mo-h2">Account</h2>
                  {!editing && <Link href={`/brands/${brandId}?edit=1`} className="bp-link" style={{ fontSize: 13 }}>Edit</Link>}
                </div>
                <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <dl className="bp-dl">
                    <dt>Billing</dt><dd style={{ color: billing.color, fontWeight: 600 }}>{billing.label}</dd>
                    <dt>Retainer</dt><dd>{b.monthly_retainer != null ? `$${Number(b.monthly_retainer).toLocaleString('en-US')}/mo` : '—'}</dd>
                    <dt>Start date</dt><dd>{b.start_date ? fmtDate(b.start_date) : '—'}</dd>
                    <dt>Client stage</dt><dd>{PIPELINE_STATUS_LABELS[b.pipeline_status]}</dd>
                    <dt>Meta ad account</dt><dd>{b.meta_ad_account_id ?? '—'}</dd>
                    <dt>Account created</dt><dd>{fmtDate(b.created_at)}</dd>
                  </dl>
                  <div>
                    <p className="bp-label">Client portal link</p>
                    <ClientPortalButton brandId={brandId} initialToken={b.client_token ?? null} />
                  </div>
                </div>
              </section>
            )}

            {isAuthorized && (
              <ConfirmDeleteForm
                action={deleteBrand.bind(null, brandId)}
                message={`Delete "${b.name}" and all its projects? This cannot be undone.`}
              >
                <button type="submit" className="bp-link" style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 500 }}>
                  Delete brand
                </button>
              </ConfirmDeleteForm>
            )}
          </aside>
        </div>
      )}

      {tab === 'dna' && (
        isAuthorized
          ? <BrandDnaPanel brandId={brandId} dna={dna} sources={dnaSources({ ...b, documents, contracts, rules, comments: brandComments })} />
          : <p className="bp-empty">Brand DNA is visible to editors.</p>
      )}

      {tab === 'files' && (
        isAuthorized ? (
          <section className="mo-panel" aria-label="Files">
            <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 26, paddingTop: 20 }}>
              <div>
                <p className="bp-label">Brand guidelines</p>
                {!hasGuidelines && <div className="bp-warn" style={{ marginBottom: 10 }}>No brand guidelines on file. Every client should have them: ask {contacts.find(c => c.is_primary)?.name ?? 'the client'} for their brand book.</div>}
                <BrandGuidelines
                  key={brandId}
                  brandId={brandId}
                  brandName={b.name}
                  guidelines={b.brand_guidelines ?? null}
                  documents={docsOf('guidelines')}
                  documentKind="guidelines"
                  embedded
                />
              </div>
              <div>
                <p className="bp-label">Contracts</p>
                <BrandContracts
                  key={contracts.map(c => c.id).join()}
                  brandId={brandId}
                  contracts={contracts}
                  documents={docsOf('contract').map(d => ({ id: d.id, file_name: d.file_name }))}
                />
              </div>
              {([
                ['logo', 'Logos', 'Upload logo files', 'Vector (SVG, AI, EPS, PDF) and PNG versions'],
                ['product_images', 'Product images', 'Upload product images', 'High-quality packshots and lifestyle shots'],
                ['fonts', 'Fonts', 'Upload font files', 'OTF, TTF, WOFF or a .zip'],
              ] as const).map(([k, label, up, hint]) => (
                <div key={k}>
                  <p className="bp-label">{label}</p>
                  <BrandDocuments
                    brandId={brandId}
                    documents={docsOf(k)}
                    kind={k}
                    title={label}
                    uploadLabel={up}
                    uploadHint={hint}
                    emptyText={`No ${label.toLowerCase()} yet. The client can add them on the intake link.`}
                  />
                </div>
              ))}
              <div>
                <p className="bp-label">Onboarding call</p>
                <OnboardingCall brandId={brandId} url={b.onboarding_call_url ?? null} transcript={b.onboarding_transcript ?? null} canEdit={isAuthorized} />
              </div>
              <div>
                <p className="bp-label">Intake</p>
                {intakeForm
                  ? <p className="bp-empty" style={{ marginBottom: 8 }}>The client&apos;s answers are under Intake answers on the Overview tab.</p>
                  : <IntakeAnswers brandId={brandId} answers={b.intake_answers ?? null} canEdit={isAuthorized} />}
                <BrandDocuments
                  brandId={brandId}
                  documents={docsOf('intake')}
                  kind="intake"
                  title="Intake files & marketing calendar"
                  uploadLabel="Upload intake form"
                  uploadHint="The filled-in intake form or questionnaire"
                  emptyText="No intake files."
                />
              </div>
              <div>
                <p className="bp-label">Everything else they have shared</p>
                <BrandDocuments
                  brandId={brandId}
                  documents={docsOf('other')}
                  kind="other"
                  title="Other files"
                  uploadLabel="Upload a file"
                  uploadHint="Product sheets, price lists, research, anything the client sends"
                  emptyText="Nothing else yet."
                />
              </div>
            </div>
          </section>
        ) : <p className="bp-empty">Files are visible to editors.</p>
      )}

      {tab === 'projects' && (
        <BrandProjects brandId={brandId} projects={allProjects} journeys={journeys} isAuthorized={isAuthorized} />
      )}

      {tab === 'feedback' && (
        <ClientRulesBoard
          brandId={brandId}
          brandName={b.name}
          rules={rules}
          people={people}
          projects={projectNames}
          canEdit={isAuthorized}
        />
      )}
    </div>
  )
}

function AccountDetailsForm({
  b, brandId, engineerNames, teamNames, action,
}: {
  b: Brand
  brandId: string
  engineerNames: string[]
  teamNames: string[]
  action: (formData: FormData) => Promise<void>
}) {
  const currentStatus = b.is_trial ? 'trial' : b.is_active ? 'active' : 'inactive'
  return (
    <section className="mo-panel mo-panel-pad" aria-label="Edit account details">
      <div className="mo-spread" style={{ marginBottom: 18 }}>
        <h2 className="mo-h2">Edit account details</h2>
        <Link href={`/brands/${brandId}`} className="bp-link bp-link-muted">Cancel</Link>
      </div>
      {/* Contacts, channel, notes, intake and files edit in place on the page. */}
      <form action={action} className="bp-form" style={{ gap: 18 }}>
        <input type="hidden" name="brand_id" value={brandId} />
        <div className="bp-grid">
          <div>
            <label htmlFor="ad-name">Brand name</label>
            <input id="ad-name" name="name" defaultValue={b.name} required />
          </div>
          <div>
            <label htmlFor="ad-website">Website</label>
            <input id="ad-website" name="website" defaultValue={b.website ?? ''} placeholder="brand.com" />
          </div>
          <div>
            <label htmlFor="ad-stage">Client stage</label>
            <select id="ad-stage" name="pipeline_status" defaultValue={b.pipeline_status}>
              {PIPELINE_STATUS_ORDER.map(s => <option key={s} value={s}>{PIPELINE_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ad-billing">Billing status</label>
            <select id="ad-billing" name="client_status" defaultValue={currentStatus}>
              <option value="active">Active</option>
              <option value="trial">On trial</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label htmlFor="ad-retainer">Monthly retainer ($)</label>
            <input id="ad-retainer" name="monthly_retainer" type="number" min="0" step="1" defaultValue={b.monthly_retainer ?? ''} placeholder="e.g. 5000" />
          </div>
          <div>
            <label htmlFor="ad-start">Start date</label>
            <input id="ad-start" name="start_date" type="date" defaultValue={b.start_date ?? ''} />
          </div>
          <div>
            <label>Profit engineer</label>
            <ProfitEngineerSelect engineers={engineerNames} current={b.profit_engineer} />
          </div>
          <div>
            <label htmlFor="ad-gs">Growth strategist</label>
            <input id="ad-gs" name="growth_strategist" list="ad-gs-team" defaultValue={b.growth_strategist ?? ''} />
            <datalist id="ad-gs-team">{teamNames.map(n => <option key={n} value={n} />)}</datalist>
          </div>
          <div>
            <label htmlFor="ad-meta">Meta ad account ID</label>
            <input id="ad-meta" name="meta_ad_account_id" defaultValue={b.meta_ad_account_id ?? ''} placeholder="act_1234567890" />
            <span className="bp-hint">Feeds the Results tab on this brand&apos;s projects.</span>
          </div>
        </div>
        <div className="bp-actions">
          <button type="submit" className="btn-primary" style={{ fontSize: 14 }}>Save</button>
          <Link href={`/brands/${brandId}`} className="bp-link bp-link-muted">Cancel</Link>
        </div>
      </form>
    </section>
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
    <span className="mo-pill" style={{
      color,
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
    }}>
      {PIPELINE_STATUS_LABELS[status]}
    </span>
  )
}
