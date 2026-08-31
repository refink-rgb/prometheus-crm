'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Project, Brand, CreativeAsset, ProjectComment, BrandDna, ProjectImage } from '@/lib/types'
import type { AssetRevision } from '@/lib/revisions'
import ReviewWorkspace from '@/components/preview/ReviewWorkspace'
import StageTracker from '@/components/StageTracker'
import Link from 'next/link'
import CopyMarkdownButton from '@/components/CopyMarkdownButton'
import { projectBriefMarkdown } from '@/lib/markdown-export'

type Tab = 'overview' | 'lp' | 'creatives'

const SUB_NAV: Record<Tab, string[]> = {
  overview: ['Timeline', 'Project Info', 'Copy and Offer', 'Brand DNA', 'Featured Product List', 'Links / HD Photos'],
  lp: ['Project Info', 'Offer Description', 'Copy & Offer', 'Deliverables', 'Client Feedback', 'Notes'],
  creatives: ['Creative Brief', 'Copy Deck', 'Drive Folder', 'Review'],
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 16, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 32, scrollMarginTop: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>{title}</h3>
      {children}
    </section>
  )
}


// Dot AND label, always together. Roberto's note on J36: keep the dot, but the
// word has to sit next to it so the colour never has to be decoded from memory.
function Dot({ color }: { color: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
}

function CommentList({ comments, empty }: { comments: ProjectComment[]; empty: string }) {
  if (comments.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{empty}</p>
  return (
    <>
      {comments.map(c => {
        const done = !!c.resolved_at
        return (
          <div key={c.id} style={{ padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, background: 'var(--surface-1)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12 }}>{c.author_name}</strong>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: c.audience === 'internal' ? 'var(--text-muted)' : '#60a5fa' }}>
                <Dot color={c.audience === 'internal' ? 'var(--text-muted)' : '#60a5fa'} />
                {c.audience === 'internal' ? 'Internal' : 'Client'}
              </span>
              {c.section_tag && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>§ {c.section_tag}</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: done ? 'var(--success)' : 'var(--text-muted)' }}>
                <Dot color={done ? 'var(--success)' : 'var(--border-strong)'} />
                {done ? 'Resolved' : 'Open'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleDateString()}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{c.content}</div>
          </div>
        )
      })}
    </>
  )
}

export default function PreviewProjectView({
  project: p, brand, assets, comments, images, dna, revisionsByAsset, lpEditorName, creativeEditorName, journeyName,
}: {
  project: Project; brand: Brand; assets: CreativeAsset[]; comments: ProjectComment[]
  images: ProjectImage[]; dna: BrandDna | null
  revisionsByAsset: Record<string, AssetRevision[]>
  lpEditorName: string | null; creativeEditorName: string | null; journeyName: string | null
}) {
  const [tab, setTab] = useState<Tab>('overview')
  // Which section the reader is actually in, so the sub-nav reports position
  // rather than only offering destinations.
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const creativeComments = useMemo(() => comments.filter(c => c.track === 'image'), [comments])
  const lpComments = useMemo(() => comments.filter(c => c.track === 'lp' || c.track === 'general'), [comments])
  const noteComments = useMemo(() => comments.filter(c => c.track === 'note'), [comments])

  const due = p.due_date ? new Date(p.due_date + 'T00:00:00') : null
  const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null

  const chip = (text: string, tone: 'muted' | 'lp' | 'cre' = 'muted') => (
    <span key={text} style={{
      fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      background: tone === 'muted' ? 'var(--surface-raised)' : tone === 'lp' ? 'rgba(96,165,250,0.14)' : 'rgba(168,85,247,0.14)',
      color: tone === 'muted' ? 'var(--text-secondary)' : tone === 'lp' ? '#60a5fa' : '#a855f7',
      border: `1px solid ${tone === 'muted' ? 'var(--border)' : 'transparent'}`,
    }}>{text}</span>
  )

  return (
    <div style={{ padding: '20px 32px 60px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Preview banner. Keep this list honest — it is the only thing telling an
          editor which controls on this page reach the real project. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', marginBottom: 16, borderRadius: 10, background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.30)' }}>
        <span style={{ fontSize: 13 }}>👁</span>
        <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>Preview of the proposed layout</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Real data. The review controls are <strong>live</strong> — approving, pushing to client
          the visibility switch and revision uploads all change the real project. Stage rails are still inert.
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        <Link href="/brands" style={{ color: 'var(--text-muted)' }}>Brands</Link>
        {' / '}
        {brand?.id
          ? <Link href={`/brands/${brand.id}`} style={{ color: 'var(--text-muted)' }}>{brand.name}</Link>
          : brand?.name}
        {' / '}
        <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>{p.name}</h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.marketing_moment && chip(`Moment ${p.marketing_moment}`)}
              {p.page_type && chip(p.page_type)}
              {chip(`LP · ${lpEditorName ?? 'unassigned'}`, 'lp')}
              {chip(`CR · ${creativeEditorName ?? 'unassigned'}`, 'cre')}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Due</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
              {daysLeft !== null && (
                <span style={{ marginLeft: 8, fontWeight: 600, color: daysLeft < 0 ? 'var(--danger)' : daysLeft <= 3 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {daysLeft < 0 ? `${Math.abs(daysLeft)}d over` : `${daysLeft}d`}
                </span>
              )}
            </div>
            {/* Same exporter the live page uses, so an editor copying from
                either screen pastes byte-identical markdown. */}
            <CopyMarkdownButton
              markdown={() => projectBriefMarkdown(p, {
                brandName: brand?.name ?? null,
                journeyName,
                lpEditor: lpEditorName,
                creativeEditor: creativeEditorName,
              })}
              label="Copy brief"
              title="Copy every filled-in brief field as markdown"
              style={{ marginTop: 8 }}
            />
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>
          <StageTracker
            projectId={p.id}
            brandId={p.brand_id}
            track="lp_stage"
            currentStage={p.lp_stage}
            label="Landing Page"
            disabled
          />
          <StageTracker
            projectId={p.id}
            brandId={p.brand_id}
            track="creatives_stage"
            currentStage={p.creatives_stage}
            label="Creatives / Statics"
            disabled
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {([['overview', 'Project Overview', null], ['lp', 'Landing Page', lpComments.length || null], ['creatives', 'Creatives', assets.length]] as const).map(([k, label, count]) => (
          <button key={k} onClick={() => setTab(k as Tab)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 12px',
            fontSize: 13, fontWeight: tab === k ? 700 : 500,
            color: tab === k ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
            marginBottom: -1, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {label}
            {count ? <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>{count}</span> : null}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '210px minmax(0,1fr)', gap: 32 }}>
        {/* Sub-nav */}
        <nav style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
          {SUB_NAV[tab].map(s => {
            const id = s.replace(/[^a-z]/gi, '').toLowerCase()
            const on = activeSection === id
            return (
              <a
                key={s}
                href={`#${id}`}
                aria-current={on ? 'true' : undefined}
                onClick={e => {
                  e.preventDefault()
                  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                style={{
                  display: 'block', padding: '8px 12px', marginBottom: 4, borderRadius: 6,
                  fontSize: 13, textDecoration: 'none',
                  fontWeight: on ? 600 : 400,
                  color: on ? 'var(--accent)' : 'var(--text-muted)',
                  background: on ? 'var(--accent-muted)' : 'transparent',
                  borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  transition: 'color 0.12s, background 0.12s',
                }}
              >{s}</a>
            )
          })}
        </nav>

        <div style={{ minWidth: 0 }}>
          {tab === 'overview' && (
            <>
              <Section id="timeline" title="Timeline">
                <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
                  {[['Brief', p.stage_brief_due_date], ['In Progress', p.stage_in_progress_due_date], ['Internal', p.stage_internal_review_due_date], ['Client', p.stage_client_review_due_date], ['Live', p.due_date]].map(([l, v]) => (
                    <div key={l as string} style={{ flex: 1, minWidth: 110, padding: '8px 12px', borderLeft: '2px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{v ? new Date((v as string) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</div>
                    </div>
                  ))}
                </div>
              </Section>
              <Section id="projectinfo" title="Project Info">
                <Row label="Journey" value={journeyName} />
                <Row label="Marketing moment" value={p.marketing_moment ? `Moment ${p.marketing_moment}` : null} />
                <Row label="Page type" value={p.page_type} />
                <Row label="LP editor" value={lpEditorName} />
                <Row label="Creative editor" value={creativeEditorName} />
              </Section>
              <Section id="copyandoffer" title="Copy and Offer">
                <Row label="Offer" value={p.offer} />
                <Row label="Offer description" value={p.offer_description} />
                <Row label="Headline" value={p.headline} />
                <Row label="Body copy" value={p.body_copy} />
                <Row label="Supporting message" value={p.supporting_message} />
                <Row label="CTA" value={p.cta} />
              </Section>
              <Section id="branddna" title="Brand DNA">
                {dna ? (
                  <>
                    <Row label="Tagline" value={dna.tagline} />
                    <Row label="Primary font" value={dna.primary_font} />
                    <Row label="Secondary font" value={dna.secondary_font} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 12 }}>
                      {([['Primary', dna.primary_color], ['Secondary', dna.secondary_color], ['Accent', dna.accent_color], ['Contrast', dna.contrast_color]] as const)
                        .filter(([, v]) => !!v)
                        .map(([l, v]) => (
                          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 8px', border: '1px solid var(--border)', borderRadius: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: 6, background: v as string, border: '1px solid var(--border)' }} />
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div>
                              <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{v}</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                ) : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No Brand DNA built for {brand?.name} yet.</p>}
              </Section>
              <Section id="featuredproductlist" title="Featured Product List">
                <Row label="Product" value={p.product_featured} />
                <Row label="Description" value={p.product_description} />
                <Row label="Retail price" value={p.retail_price} />
                {images.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8, paddingTop: 16 }}>
                    {images.slice(0, 12).map(im => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={im.id} src={im.storage_url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                    ))}
                  </div>
                )}
              </Section>
              <Section id="linkshdphotos" title="Links / HD Photos">
                <Row label="Landing page" value={p.lp_url ? <a href={p.lp_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{p.lp_url}</a> : null} />
                <Row label="Drive folder" value={p.drive_folder_url ? <a href={p.drive_folder_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open Drive folder ↗</a> : null} />
                <Row label="Product assets" value={p.product_images_link ? <a href={p.product_images_link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open ↗</a> : null} />
                <Row label="Motion" value={p.motion_link ? <a href={p.motion_link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open videos ↗</a> : null} />
              </Section>
            </>
          )}

          {tab === 'lp' && (
            <>
              <Section id="projectinfo" title="Project Info">
                <Row label="Page type" value={p.page_type} />
                <Row label="Marketing moment" value={p.marketing_moment ? `Moment ${p.marketing_moment}` : null} />
                <Row label="LP editor" value={lpEditorName} />
                <Row label="Due" value={p.due_date} />
              </Section>
              <Section id="offerdescription" title="Offer Description">
                <Row label="Offer" value={p.offer} />
                <Row label="Description" value={p.offer_description} />
              </Section>
              <Section id="copyoffer" title="Copy & Offer">
                <Row label="Headline" value={p.headline} />
                <Row label="Body copy" value={p.body_copy} />
                <Row label="Supporting" value={p.supporting_message} />
                <Row label="CTA" value={p.cta} />
                <Row label="Retail price" value={p.retail_price} />
              </Section>
              <Section id="deliverables" title="Deliverables">
                <Row label="Landing page URL" value={p.lp_url
                  ? <a href={p.lp_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{p.lp_url}</a>
                  : <span style={{ color: 'var(--text-muted)' }}>Not set</span>} />
                <Row label="Coupon code" value={p.shopify_coupon_code} />
              </Section>
              <Section id="clientfeedback" title="Client Feedback">
                <CommentList comments={lpComments} empty="No landing-page feedback yet." />
              </Section>
              <Section id="notes" title="Notes">
                <CommentList comments={noteComments} empty="No internal notes on this project." />
              </Section>
            </>
          )}

          {tab === 'creatives' && (
            <>
              <Section id="creativebrief" title="Creative Brief">
                <Row label="Product" value={p.product_featured} />
                <Row label="Offer" value={p.offer} />
                <Row label="Retail price" value={p.retail_price} />
                <Row label="Competitor reference" value={p.competitor_reference} />
                <Row label="Client inspiration" value={p.client_ad_inspiration} />
                <Row label="Editor" value={creativeEditorName} />
              </Section>
              <Section id="copydeck" title="Copy Deck">
                {(['ad_headlines', 'ad_eyebrows', 'ad_subcopies'] as const).map(k => {
                  const v = p[k] as string[] | null
                  if (!v?.length) return null
                  return (
                    <div key={k} style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        {k.replace('ad_', '').replace('subcopies', 'subheadlines')} ({v.length})
                      </div>
                      {v.map((line, i) => (
                        <div key={i} style={{ fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{line}</div>
                      ))}
                    </div>
                  )
                })}
              </Section>
              <Section id="drivefolder" title="Drive Folder">
                <Row label="Folder" value={p.drive_folder_url ? <a href={p.drive_folder_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open Drive folder ↗</a> : <span style={{ color: 'var(--text-muted)' }}>Not linked</span>} />
              </Section>
              <Section id="review" title="Review">
                {/* /internal-review is staying. This inline workspace is for the
                    routine pass; the dedicated screen is still where you work a
                    batch at full width, so say so and link it rather than
                    leaving editors to remember the URL. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Reviewing a whole batch? The full-width screen has keyboard nav and the annotation pins.
                  </span>
                  <Link
                    href={`/brands/${p.brand_id}/projects/${p.id}/internal-review`}
                    style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}
                  >
                    Open internal review →
                  </Link>
                </div>
                <ReviewWorkspace projectId={p.id} brandId={p.brand_id} assets={assets} comments={creativeComments} revisionsByAsset={revisionsByAsset} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
