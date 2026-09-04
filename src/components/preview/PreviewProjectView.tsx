'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Project, Brand, CreativeAsset, ProjectComment, BrandDna, ProjectImage, Journey, Profile, BrandComment, BrandDocument } from '@/lib/types'
import ProjectEditForm from '@/components/ProjectEditForm'
import StageTracker from '@/components/StageTracker'
import CopyDeckPanel from '@/components/CopyDeckPanel'
import CreativeAssetsManager from '@/components/CreativeAssetsManager'
import ClientFeedbackPanel from '@/components/ClientFeedbackPanel'
import CampaignTrackingPanel from '@/components/CampaignTrackingPanel'
import NotesThread from '@/components/NotesThread'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import FinalOutputField from '@/components/FinalOutputField'
import EditorPicker from '@/components/EditorPicker'
import { editorsFor } from '@/lib/types'
import { profileName } from '@/lib/types'
import type { TrackedCampaign } from '@/lib/results'
import { hypercareFor, hypercareCopyMessage } from '@/lib/hypercare'
import ShareButton from '@/components/ShareButton'
import { Pencil } from 'lucide-react'
import { markProjectComplete, deleteProject, reopenProject } from '@/lib/actions'
import SubmitButton from '@/components/SubmitButton'
import type { AssetRevision } from '@/lib/revisions'
import ReviewWorkspace from '@/components/preview/ReviewWorkspace'
import Link from 'next/link'
import CopyMarkdownButton from '@/components/CopyMarkdownButton'
import ListEditor, { type ListRow } from '@/components/preview/ListEditor'
import { readProducts, readCompetitors, readTopPerformers, readCopyApprovals, readAssetFolders, groupProducts, productsDrifted, offerSource, splitSkus } from '@/lib/products'
import ProductGroupEditor from '@/components/preview/ProductGroupEditor'
import CopyApprovalDeck from '@/components/preview/CopyApprovalDeck'
import BrandBrief from '@/components/preview/BrandBrief'
import DriveSyncBar from '@/components/preview/DriveSyncBar'
import NextStep from '@/components/preview/NextStep'
import BrandGuidelines from '@/components/preview/BrandGuidelines'
import BrandThread from '@/components/preview/BrandThread'
import { summariseProjectOffer, fetchProductThumbnails } from '@/lib/actions'
import { projectBriefMarkdown } from '@/lib/markdown-export'
import { STAGE_COLORS } from '@/lib/stageColors'
import { STAGE_LABELS, normalizeStage } from '@/lib/types'

const isUrl = (v: string) => /^https?:\/\//i.test(v.trim())
const hostOf = (u: string) => { try { return new URL(u).host } catch { return u } }
const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/$/, '') } catch { return '' } }

// Several of these fields hold far more than a field's worth of text: offer
// descriptions average ~985 characters, and one Noble supporting_message holds
// 52,723 — a pasted meeting transcript that renders as a ~700-line wall.
// The character count in the toggle is load-bearing: it tells you a field is a
// transcript before you open it.
function Clamp({ text, lines }: { text: string; lines: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > lines * 90
  return (
    <>
      <div style={open ? { whiteSpace: 'pre-wrap' } : {
        display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', whiteSpace: 'pre-wrap',
      }}>{text}</div>
      {long && (
        <button onClick={() => setOpen(v => !v)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer' }}>
          {open ? 'Show less' : `Show all (${text.length.toLocaleString()} characters)`}
        </button>
      )}
    </>
  )
}

// Copy is meant to be lifted, not retyped.
function CopyLine({ text, lead = false }: { text: string; lead?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1000) } catch { /* clipboard blocked — say nothing */ }
      }}
      style={{
        textAlign: 'left', width: '100%', fontSize: lead ? 15 : 13, fontWeight: lead ? 700 : 400,
        padding: lead ? '10px 12px' : '6px 12px', marginBottom: 4,
        border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)',
        color: copied ? 'var(--success)' : 'var(--text-primary)', cursor: 'pointer',
        whiteSpace: 'normal', lineHeight: 1.45,
      }}
    >{copied ? 'Copied' : text}</button>
  )
}

// Replaces Row on this tab. A 190px label gutter beside 22 fields is what made
// the old Overview read as a form: every fact, load-bearing or not, got the
// same weight.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxWidth: '68ch' }}>{children}</div>
    </div>
  )
}

// Collapsed by default. Used where the content is reference material an editor
// consults rather than reads every time.
function Disclosure({ title, meta, open: initial = false, children }: {
  title: string; meta?: string; open?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(initial)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 10 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{title}</span>
        {meta && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta}</span>}
      </button>
      {open && <div style={{ padding: '0 12px 12px 30px' }}>{children}</div>}
    </div>
  )
}

function CtaPill({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      title="Click to copy the button label"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1000) } catch { /* clipboard blocked */ }
      }}
      style={{
        display: 'inline-block', border: `1px solid ${copied ? 'var(--success)' : 'var(--accent)'}`,
        color: copied ? 'var(--success)' : 'var(--accent)', background: 'none',
        borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      }}
    >{copied ? 'Copied' : text}</button>
  )
}

function Card({ id, title, purpose, children }: { id: string; title: string; purpose: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card" style={{ marginBottom: 32, scrollMarginTop: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, marginBottom: 16 }}>{purpose}</div>
      {children}
    </section>
  )
}

// A missing fact an editor can act on, not a blank to skim past.
function Missing({ tone = 'muted', children }: { tone?: 'warn' | 'muted'; children: React.ReactNode }) {
  const warn = tone === 'warn'
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
      background: warn ? 'var(--urgent-soon-bg)' : 'var(--surface-2)',
      color: warn ? 'var(--urgent-soon)' : 'var(--text-secondary)',
      border: `1px solid ${warn ? 'var(--urgent-soon)' : 'var(--border)'}`,
    }}>{children}</div>
  )
}

type Tab = 'overview' | 'lp' | 'creatives'

/** One row of the brand's landing-page history. */
export type BrandLandingPage = {
  id: string
  name: string
  offer: string | null
  lp_url: string | null
  due_date: string | null
  lp_stage: string | null
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
  project: p, brand, assets, comments, images, dna, revisionsByAsset, lpEditorName, creativeEditorName, journeyName, journeys, profiles, campaigns, todayIso, authorName, brandLandingPages, brandComments, brandDocuments, currentUserId,
}: {
  project: Project; brand: Brand; assets: CreativeAsset[]; comments: ProjectComment[]
  images: ProjectImage[]; dna: BrandDna | null
  revisionsByAsset: Record<string, AssetRevision[]>
  lpEditorName: string | null; creativeEditorName: string | null; journeyName: string | null
  journeys: Journey[]; profiles: Profile[]; campaigns: TrackedCampaign[]; todayIso: string
  brandLandingPages: BrandLandingPage[]
  brandComments: BrandComment[]
  brandDocuments: BrandDocument[]
  currentUserId: string | null
  /** Who a note typed here is attributed to. */
  authorName: string
}) {
  const [tab, setTab] = useState<Tab>('overview')

  // The section list collapses to a 36px rail of dots. Same idiom as the app
  // sidebar (Janella, 3 Sep) — its own storage key, so the two collapsibles
  // never fight over one setting.
  //
  // Dots, not the sidebar's icons: several labels carry a live count
  // ("Products · 12", "Client feedback · 3 open") that an icon would throw
  // away. Collapsed, that whole label moves into the dot's tooltip.
  //
  // Read from storage in an effect only, never during render — this is a client
  // component inside a server-rendered page, and reading localStorage on the
  // first render is a hydration mismatch. Only an explicit toggle is written
  // back — see toggleNav; persisting the responsive default would freeze it.
  const [navCollapsed, setNavCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('prometheus-subnav-collapsed')
      // Nothing stored yet: collapse by default on a narrow screen, where a
      // 210px column plus a 32px gap was eating most of the viewport.
      //
      // localStorage and matchMedia do not exist on the server, so neither can
      // be read during render without a hydration mismatch. One extra render on
      // mount is the price of restoring the preference at all.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNavCollapsed(stored === null
        ? !window.matchMedia('(min-width: 1100px)').matches
        : stored === '1')
    } catch { /* private window, or storage blocked — start expanded */ }
  }, [])

  // Persist the CHOICE, never the state. Writing the responsive default back on
  // first mount froze it: one visit on a 13" laptop stored '1', and the nav was
  // then a rail of dots on a 27" monitor forever, with nothing to explain why.
  const toggleNav = () => {
    setNavCollapsed(v => {
      const next = !v
      try { localStorage.setItem('prometheus-subnav-collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  // Which section the reader is actually in, so the sub-nav reports position
  // rather than only offering destinations.
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Notifications deep-link to #client-feedback, and that anchor lives inside the
  // Landing Page tab. Arriving with the hash while Overview is showing meant the
  // target was not in the DOM at all, so the bell dropped you at the top of the
  // page with no indication of why. Switch to the tab that owns the hash, then
  // scroll once it has rendered.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const owner: Record<string, Tab> = {
      'client-feedback': 'lp', feedback: 'lp', page: 'lp', offer: 'lp', copy: 'lp',
      library: 'lp', notes: 'lp', product: 'lp',
      brief: 'creatives', products: 'creatives', motion: 'creatives', review: 'creatives',
      making: 'overview', about: 'overview', look: 'overview', destination: 'overview',
    }
    const t = owner[hash]
    if (t) setTab(t)
    // Two frames: one for the tab switch to commit, one for its content to mount.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }))
  }, [])

  // `assets` now arrives with hidden rows included, because CreativeAssetsManager
  // is the only place that can un-hide one and it needs to see them. Everything
  // else — the grid, the review loop, the counts, the client feedback panel —
  // works from the visible set.
  const visibleAssets = useMemo(() => assets.filter(a => !a.is_hidden), [assets])

  const creativeComments = useMemo(() => comments.filter(c => c.track === 'image'), [comments])
  const lpComments = useMemo(
    // 'general' is addProjectComment's DEFAULT track and CommentForm passes no
    // track at all, so excluding it means the first comment posted through that
    // form disappears. Zero rows use it today; that is luck, not safety.
    () => comments.filter(c => c.track === 'lp' || c.track === 'general'),
    [comments],
  )
  const noteComments = useMemo(() => comments.filter(c => c.track === 'note'), [comments])

  // One media query, used in exactly one place (section 1's split).
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)')
    const sync = () => setWide(mq.matches)
    sync(); mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const products = useMemo(() => readProducts(p), [p])
  const competitors = useMemo(() => readCompetitors(p), [p])
  const topPerformers = useMemo(() => readTopPerformers(p), [p])
  const assetFolders = useMemo(() => readAssetFolders(p), [p])
  const grouped = useMemo(() => groupProducts(products), [products])
  const copyApprovals = useMemo(() => readCopyApprovals(p), [p])
  const drifted = productsDrifted(p)
  const skus = useMemo(() => products.map(x => x.name), [products])

  const [editing, setEditing] = useState<null | 'products' | 'competitors' | 'top' | 'folders'>(null)
  // Noble never generates AI copy — Lucas Dias writes it. Checked here as well
  // as in the action so the button is never even offered.
  const hypercareRule = hypercareFor(brand?.name)
  const [summary, setSummary] = useState<string[] | null>(null)
  const [summarising, setSummarising] = useState(false)
  const [summaryErr, setSummaryErr] = useState('')
  const [thumbing, setThumbing] = useState(false)
  const [thumbNote, setThumbNote] = useState('')

  // Cached bullets are only shown while they still describe the CURRENT offer.
  // Editing the offer must not leave a confident summary of the previous one.
  const cachedSummary = p.offer_summary && p.offer_summary_source === offerSource(p)
    ? p.offer_summary
    : null
  const shownSummary = summary ?? cachedSummary
  const summaryStale = !!p.offer_summary && !cachedSummary

  // Escalating fallback when no image is stored, so the loud "don't guess" state
  // is reserved for a genuine dead end.
  const imageFallback = p.product_images_link ? { href: p.product_images_link, label: 'Open product photos ↗' }
    : p.drive_folder_url ? { href: p.drive_folder_url, label: 'Open Drive folder ↗' }
    : p.lp_url ? { href: p.lp_url, label: 'See it on the landing page ↗' }
    : null

  const hasAdCopy = !!(p.ad_eyebrows?.length || p.ad_headlines?.length || p.ad_subcopies?.length)
  const hasLpCopy = !!(p.headline || p.body_copy || p.supporting_message || p.cta)

  // The DNA fields that are actually populated. Measured over the 13 active
  // brand_dna rows: these run 10-13/13, while the fonts the old section led with
  // are 4-6/13 and tagline is decorative.
  const LOOK_FIELDS = useMemo(() => ([
    ['Subject matter', dna?.subject_matter],
    ['Composition', dna?.composition],
    ['Lighting', dna?.lighting],
    ['Mood', dna?.mood],
    ['Props and surfaces', dna?.props_and_surfaces],
    ['Text overlay', dna?.text_overlay_style],
    ['Offer presentation', dna?.offer_presentation],
    ['Positioning', dna?.positioning],
  ] as const).filter(([, v]) => !!v) as ReadonlyArray<readonly [string, string]>, [dna])
  const showLook = LOOK_FIELDS.length > 0
  const hooks: string[] = Array.isArray(dna?.winning_hooks) ? dna!.winning_hooks as string[] : []

  const missing = useMemo(() => ([
    { when: images.length === 0 && !p.product_images_link, label: 'No product image', to: 'about' },
    { when: !p.retail_price, label: 'No price anchor', to: 'making' },
    { when: !p.offer_dynamics_type, label: 'No offer mechanic', to: 'making' },
    { when: !hasAdCopy, label: 'No ad copy', to: 'copy' },
    { when: !p.page_type, label: 'No page type', to: 'destination' },
    { when: !p.lp_url, label: 'No LP URL', to: 'destination' },
  ]).filter(m => m.when), [images.length, p.product_images_link, p.retail_price, p.offer_dynamics_type, hasAdCopy, p.page_type, p.lp_url])

  // Sections that don't render get no nav entry — the nav never advertises a
  // destination that turns out to be an apology.
  const overviewNav = useMemo(() => ([
    { id: 'about', label: 'About', show: true },
    { id: 'making', label: 'Offer', show: true },
    { id: 'copy', label: 'Copy', show: hasAdCopy || hasLpCopy },
    { id: 'look', label: 'Look', show: showLook },
    { id: 'destination', label: 'Destination', show: true },
  ]).filter(n => n.show), [hasAdCopy, hasLpCopy, showLook])

  const lpCopyMissing = useMemo(() => ([
    [p.headline, 'a headline'], [p.body_copy, 'body copy'],
    [p.supporting_message, 'a supporting line'], [p.cta, 'a button label'],
  ] as const).filter(([v]) => !v).map(([, label]) => label), [p.headline, p.body_copy, p.supporting_message, p.cta])

  const clientLpFeedback = useMemo(() => lpComments.filter(c => c.audience !== 'internal'), [lpComments])
  const clientCreativeFeedback = useMemo(() => creativeComments.filter(c => c.audience !== 'internal'), [creativeComments])

  const lpOpen = useMemo(() => lpComments.filter(c => !c.resolved_at), [lpComments])
  const lpResolved = useMemo(() => lpComments.filter(c => !!c.resolved_at), [lpComments])
  const hasProduct = !!(p.product_featured || p.product_description || images.length)
  const lockedAt = p.offer_locked_at
    ? new Date(p.offer_locked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  // Length-based, not content-based, and deliberately blunt. One Noble row holds
  // 52,723 characters — a pasted meeting call transcript, not page copy. 2,000 is
  // 4x the longest legitimate value on file (486) and 10x p90 (196), so it fires
  // on that row alone. Clamp is not enough here: it still mounts 52KB and leaves
  // a "Show all" trapdoor one click from the editor's clipboard.
  const SUPPORT_CAP = 2000
  const supportPoisoned = !!p.supporting_message && p.supporting_message.length > SUPPORT_CAP

  const lpNav = useMemo(() => ([
    { id: 'page', label: 'Final output', show: true },
    { id: 'library', label: brandLandingPages.length ? `Past pages · ${brandLandingPages.length}` : 'Past pages', show: brandLandingPages.length > 1 },
    { id: 'offer', label: 'The offer', show: true },
    { id: 'copy', label: 'Page copy', show: true },
    { id: 'product', label: 'Product', show: hasProduct },
    { id: 'feedback', label: lpOpen.length ? `Client feedback · ${lpOpen.length} open` : 'Client feedback', show: lpComments.length > 0 },
    { id: 'notes', label: 'Internal notes', show: true },
  ]).filter(n => n.show), [hasProduct, lpOpen.length, lpComments.length, noteComments.length, brandLandingPages.length])

  // Products and Motion reports are always shown, even empty: an empty list is
  // the prompt to fill it, and hiding it hides the only place the work happens.
  const creativesNav = useMemo(() => ([
    { id: 'brief', label: 'Brief', show: true },
    { id: 'products', label: products.length ? `Products · ${products.length}` : 'Products', show: true },
    { id: 'motion', label: competitors.length ? `Motion reports · ${competitors.length}` : 'Motion reports', show: true },
    { id: 'copy', label: 'Copy deck', show: true },
    { id: 'review', label: 'Review', show: true },
  ]).filter(n => n.show), [hasAdCopy, products.length, competitors.length])

  const activeNav = tab === 'overview' ? overviewNav : tab === 'lp' ? lpNav : creativesNav

  // Scroll-spy. This was written once before and silently did nothing — the edit
  // anchored on a line that had already changed, so activeSection stayed null and
  // the sub-nav's active state never fired on any tab.
  useEffect(() => {
    const els = activeNav.map(n => document.getElementById(n.id)).filter(Boolean) as HTMLElement[]
    if (!els.length) return
    setActiveSection(activeNav[0].id)
    const io = new IntersectionObserver(
      entries => {
        const hit = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActiveSection(hit.target.id)
      },
      // Biased to the upper third: the section being read is the one under the
      // header, not whichever happens to fill the most screen.
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [activeNav])

  // No 'Live' entry: the Due block above is the live date, and printing it twice
  // is what let the old Timeline disagree with the header.
  const stageDates = useMemo(() => ([
    ['Brief', p.stage_brief_due_date], ['In progress', p.stage_in_progress_due_date],
    ['Internal', p.stage_internal_review_due_date], ['Client', p.stage_client_review_due_date],
  ] as const).filter(([, v]) => !!v).map(([label, v]) => {
    const d = new Date(v as string + 'T00:00:00')
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000)
    return {
      label,
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      tone: days < 0 ? 'var(--urgent-overdue)' : days <= 3 ? 'var(--urgent-soon)' : 'var(--text-primary)',
    }
  }), [p.stage_brief_due_date, p.stage_in_progress_due_date, p.stage_internal_review_due_date, p.stage_client_review_due_date])

  const due = p.due_date ? new Date(p.due_date + 'T00:00:00') : null
  const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null

  // Tiny uppercase label that names a group of chips, so the status row reads
  // as "Status: … Owners: …" instead of one undifferentiated run of pills.
  const groupLabel = (text: string) => (
    <span key={`label-${text}`} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginRight: 2 }}>{text}</span>
  )
  const chip = (text: string, tone: 'muted' | 'lp' | 'cre' = 'muted') => (
    <span key={text} style={{
      fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      background: tone === 'muted' ? 'var(--surface-raised)' : tone === 'lp' ? 'rgba(96,165,250,0.14)' : 'rgba(168,85,247,0.14)',
      color: tone === 'muted' ? 'var(--text-secondary)' : tone === 'lp' ? '#60a5fa' : '#a855f7',
      border: `1px solid ${tone === 'muted' ? 'var(--border)' : 'transparent'}`,
    }}>{text}</span>
  )

  // Was capped at 1280 whatever the monitor. Prose inside the cards is already
  // capped at 68-80ch, so widening the shell gives the grids and the review
  // panel room without turning body text into unreadable full-width lines.
  return (
    <div className="page-contrast" style={{ padding: '20px 32px 60px', maxWidth: 1760, margin: '0 auto' }}>
      {/* Brand-wide, above everything. The preview had lost this entirely, so a
          Noble project looked like any other and an editor would generate copy
          Lucas is supposed to write. */}
      {hypercareRule && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, marginBottom: 20, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10 }}>
          <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>⚠</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444', marginBottom: 2 }}>
              Hypercare — reach out to {hypercareRule.contact} for ad copy
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {hypercareRule.reason} Copy generation is disabled on every {brand?.name} project.
            </div>
          </div>
        </div>
      )}

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
      <div className="card" style={{ marginBottom: 16, padding: '20px 24px 22px' }}>
        {/* Title with one line of facts under it; every action in a single row
            on the right. The old layout stacked three buttons under a "Due"
            block and left the title floating beside 150px of empty space. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2, margin: 0 }}>{p.name}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px', marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>Due </span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {due ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </strong>
                {daysLeft !== null && (
                  <span style={{ marginLeft: 6, fontWeight: 600, color: daysLeft < 0 ? 'var(--danger)' : daysLeft <= 3 ? 'var(--warning)' : 'var(--text-muted)' }}>
                    {daysLeft < 0 ? `${Math.abs(daysLeft)}d over` : daysLeft === 0 ? 'today' : `${daysLeft}d left`}
                  </span>
                )}
              </span>
              {journeyName && <><span style={{ color: 'var(--text-muted)' }}>·</span><span>{journeyName}</span></>}
              {p.marketing_moment ? <><span style={{ color: 'var(--text-muted)' }}>·</span><span>Moment {p.marketing_moment}</span></> : null}
              {p.is_complete && <><span style={{ color: 'var(--text-muted)' }}>·</span><span style={{ color: 'var(--complete-text)', fontWeight: 600 }}>Complete — locked</span></>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
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
              title="Copy the brief as markdown"
            />
            {p.is_complete ? (
              // Complete was a dead end: rails disabled, edit hidden, nothing
              // able to move. A client coming back a week later with one more
              // change had nowhere to go but a whole new project.
              <form action={reopenProject.bind(null, p.id, p.brand_id, 'creatives_stage')}>
                <SubmitButton
                  pendingText="Reopening…"
                  style={{ fontSize: 'var(--text-sm)', fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Reopen to internal review
                </SubmitButton>
              </form>
            ) : (
              <button
                onClick={() => window.dispatchEvent(new Event('prometheus-open-edit'))}
                className="btn-secondary"
                style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}
              ><Pencil size={14} strokeWidth={2} aria-hidden /> Edit details</button>
            )}
            {/* The client review link. The visibility switches in Review decide
                WHAT the client sees; this is the URL they see it at, and without
                it those switches have no reachable payoff. Until one exists it
                is a single button here; once generated it needs a full row. */}
            {!p.share_token && <ShareButton projectId={p.id} initialToken={p.share_token} />}
          </div>
        </div>

        {p.share_token && (
          <div style={{ marginTop: 14 }}>
            {groupLabel('Client review link')}
            <div style={{ marginTop: 6 }}>
              <ShareButton projectId={p.id} initialToken={p.share_token} />
            </div>
          </div>
        )}
        {/* Two inert 7-step rails cost ~240px and rendered the pipeline at a
            granularity the old Timeline section disagreed with — Revisions and
            Ready have no dates, Internal and Client were abbreviated differently,
            so two adjacent renderings of the same pipeline visibly contradicted
            each other. One line of stage state, plus the dates that exist. */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {groupLabel('Status')}
            {([['LP', p.lp_stage], ['CRE', p.creatives_stage]] as const).map(([k, st]) => {
              const norm = normalizeStage(st)
              const c = STAGE_COLORS[norm]
              return (
                <span key={k} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: c.bg, color: c.text }}>
                  {k} · {STAGE_LABELS[norm]}
                </span>
              )
            })}
            <span aria-hidden style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 6px' }} />
            {groupLabel('Owners')}
            {/* Instant mode, like the live page: guards the capability flag,
                logs an `assigned` pipeline event and notifies the editor. The
                edit form's plain select writes the FK and none of that, so
                assignment there was silent. */}
            {!p.is_complete ? (
              <>
                <EditorPicker mode="instant" track="lp" options={editorsFor(profiles, 'is_lp_editor')} current={p.lp_editor_id} projectId={p.id} brandId={p.brand_id} />
                <EditorPicker mode="instant" track="creative" options={editorsFor(profiles, 'is_creative_editor')} current={p.creative_editor_id} projectId={p.id} brandId={p.brand_id} />
              </>
            ) : (
              <>
                {chip(`LP · ${lpEditorName ?? 'unassigned'}`, 'lp')}
                {chip(`CR · ${creativeEditorName ?? 'unassigned'}`, 'cre')}
              </>
            )}
            {p.offer_locked ? <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--complete-bg)', color: 'var(--complete-text)' }}>Offer locked</span> : null}
          </div>

          {/* The pills above say where the project IS. This is how it MOVES.
              Behind a disclosure because advancing a stage is a once-a-week act
              and the two 7-step rails cost ~240px of permanent header. */}
          <details className="stage-moves" style={{ marginTop: 14 }}>
            {/* Styled as a button bar, not an 11px line of text: the one-line
                summary was easy to miss, and this is the only way to move a
                card sideways or back. Still collapsed by default — see above. */}
            <summary>
              <svg className="stage-moves-chev" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Move a stage</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                Advance, send back, or jump either track
              </span>
            </summary>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {/* Locked once complete, like the live page. A finished project
                  should not quietly move backwards. */}
              <StageTracker projectId={p.id} brandId={p.brand_id} track="lp_stage" currentStage={p.lp_stage} label="Landing Page" disabled={p.is_complete} />
              <StageTracker projectId={p.id} brandId={p.brand_id} track="creatives_stage" currentStage={p.creatives_stage} label="Creatives / Statics" disabled={p.is_complete} />
            </div>
          </details>

          {/* Present-only. 16 of 66 projects have no stage dates at all and used
              to get a row of five em-dashes as the first thing on the tab. */}
          {stageDates.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 11, borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>Stage dates</span>
              {stageDates.map(d => (
                <span key={d.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                  {d.label} <span style={{ color: d.tone, fontWeight: 700 }}>{d.date}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Every scalar field on the project. The preview rebuilt the reading of
          these fields; this is the writing of them, unchanged from the live page
          so there is exactly one edit form in the app. It opens on the
          prometheus-open-edit event, which the button below dispatches. */}
      <ProjectEditForm
        projectId={p.id}
        brandId={p.brand_id}
        journeys={journeys}
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
          motion_link: p.motion_link,
          shopify_coupon_code: p.shopify_coupon_code,
          lp_editor_id: p.lp_editor_id,
          creative_editor_id: p.creative_editor_id,
        }}
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {([['overview', 'Project Overview', null], ['lp', 'Landing Page', lpOpen.length || null], ['creatives', 'Creatives', visibleAssets.length]] as const).map(([k, label, count]) => (
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

      <div style={{
        display: 'grid',
        gridTemplateColumns: navCollapsed ? '36px minmax(0,1fr)' : '210px minmax(0,1fr)',
        gap: navCollapsed ? 16 : 32,
        transition: 'grid-template-columns 0.15s, gap 0.15s',
      }}>
        {/* Sub-nav */}
        <nav style={{ position: 'sticky', top: 16, alignSelf: 'start' }}>
          <button
            onClick={toggleNav}
            title={navCollapsed ? 'Expand section list' : 'Collapse section list'}
            aria-label={navCollapsed ? 'Expand section list' : 'Collapse section list'}
            aria-expanded={!navCollapsed}
            style={{
              margin: navCollapsed ? '0 auto 8px' : '0 0 8px auto', display: 'block',
              width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: 12,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
            }}
          >{navCollapsed ? '›' : '‹'}</button>

          {activeNav.map(({ id, label: s }) => {
            const on = activeSection === id
            const go = (e: React.MouseEvent) => {
              e.preventDefault()
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            // Collapsed: one dot per section, the label — count included — in
            // the tooltip. The nav still does both its jobs, report where you
            // are and offer somewhere to go, at a sixth of the width.
            if (navCollapsed) {
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  title={s}
                  aria-label={s}
                  aria-current={on ? 'true' : undefined}
                  onClick={go}
                  style={{ display: 'grid', placeItems: 'center', height: 22, textDecoration: 'none', marginBottom: 2 }}
                >
                  <span style={{
                    width: on ? 10 : 6, height: on ? 10 : 6, borderRadius: '50%',
                    background: on ? 'var(--accent)' : 'var(--text-muted)',
                    opacity: on ? 1 : 0.45,
                    transition: 'width 0.12s, height 0.12s, background 0.12s, opacity 0.12s',
                  }} />
                </a>
              )
            }
            return (
              <a
                key={id}
                href={`#${id}`}
                aria-current={on ? 'true' : undefined}
                onClick={go}
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
              {/* First thing on the tab, by design — "anytime you open up a
                  project it's the first thing that you see". Lives on the brand,
                  so every project for this client shows the same notes. */}
              {brand?.id && (
                <BrandBrief
                  // Remount when the stored value changes: this component holds a
                  // draft in useState seeded from props, so without a key the
                  // second save writes a stale draft over the first.
                  key={`${brand.brand_notes ?? ''}::${brand.ai_sensitivity ?? ''}`}
                  brandId={brand.id}
                  brandName={brand.name}
                  projectId={p.id}
                  notes={brand.brand_notes ?? null}
                  sensitivity={brand.ai_sensitivity ?? null}
                />
              )}

              {brand?.id && (
                <BrandThread
                  brandId={brand.id}
                  brandName={brand.name}
                  projectId={p.id}
                  comments={brandComments}
                  currentUserId={currentUserId}
                />
              )}

              {brand?.id && (
                /* Keyed on brand.id, NOT on the guidelines text. Keyed on the
                   text, saving the box mid-upload remounted the whole panel and
                   threw away the in-flight upload and its error list. */
                <BrandGuidelines
                  key={brand.id}
                  brandId={brand.id}
                  brandName={brand.name}
                  projectId={p.id}
                  guidelines={brand.brand_guidelines ?? null}
                  documents={brandDocuments}
                />
              )}

              {/* What is missing, named and jumpable. No score and no meters —
                  a ledger can only certify that a fact is on file, not that it
                  is the right fact, and false confidence is the error this
                  screen exists to prevent. */}
              {missing.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Missing</span>
                  {missing.map(m => (
                    <a
                      key={m.label}
                      href={`#${m.to}`}
                      onClick={e => { e.preventDefault(); document.getElementById(m.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px dashed var(--border-strong)', textDecoration: 'none' }}
                    >{m.label}</a>
                  ))}
                </div>
              )}

              {/* 1 — what it is. Split out of the old single card: with the
                  images, the SKU list, the description AND the whole offer in
                  one section it ran past two screens, so nobody scrolled to the
                  bottom of it. Jaspen, 3 Sep. */}
              <Card id="about" title="About the product" purpose="What it is, and what it looks like.">
                <div style={{ display: 'grid', gridTemplateColumns: wide && images.length > 0 ? '360px minmax(0,1fr)' : '1fr', gap: 20 }}>
                  {/* No image, no column. The empty state used to be a square the
                      size of the hero announcing it had nothing to show — on 37 of
                      the 59 projects that name a product. The product link answers
                      the same question now, and the Drive fallback moved into the
                      spec beside it, where it costs one line instead of a card. */}
                  {images.length > 0 && (
                    <div>
                      {/* contain, never cover: cropping a label is how a wrong SKU survives review. */}
                      <a href={images[0].storage_url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={images[0].storage_url} alt={p.product_featured ?? 'Product reference'} loading="lazy" decoding="async"
                          style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--border-strong)', display: 'block' }} />
                      </a>
                      {images.length > 1 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                          {/* No cap. Five projects hold 14-22 references and the old
                              slice(0,12) dropped the rest silently. */}
                          {images.slice(1).map((im, i) => (
                            <a key={im.id} href={im.storage_url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={im.storage_url} alt={`Reference ${i + 2}`} loading="lazy"
                                style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                            </a>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                        {images.length} reference{images.length === 1 ? '' : 's'} · click to enlarge
                      </div>
                    </div>
                  )}

                  <div>
                    {skus.length === 0 ? (
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-muted)' }}>Product not specified</div>
                    ) : skus.length === 1 && isUrl(skus[0]) ? (
                      <>
                        <a href={skus[0]} target="_blank" rel="noreferrer" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>Product page ↗</a>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>A link, not a name.</div>
                      </>
                    ) : skus.length === 1 ? (
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>{skus[0]}</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>{skus.length} SKUs in this ad</div>
                        {skus.map((sku, i) => (
                          <div key={sku} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                            <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 4, background: 'var(--surface-raised)', color: 'var(--text-secondary)', fontSize: 10, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                            <span style={{ fontSize: i === 0 ? 20 : 15, fontWeight: i === 0 ? 700 : 600, letterSpacing: i === 0 ? '-0.01em' : undefined }}>{sku}</span>
                          </div>
                        ))}
                      </>
                    )}

                    {p.product_description && (
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
                        <Clamp text={p.product_description} lines={2} />
                      </div>
                    )}

                    {/* Lifted out of the Price block, which now lives in the
                        Offer card. "Where are the product photos" is an About
                        question wherever the price happens to sit. */}
                    {images.length === 0 && imageFallback && (
                      <div style={{ marginTop: 16 }}>
                        <a href={imageFallback.href} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>{imageFallback.label}</a>
                      </div>
                    )}
                  </div>
                </div>

                {/* The only place the DNA gap is mentioned — better than a whole
                    section that is an apology, with a nav entry pointing at it. */}
                {!showLook && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    No Brand DNA for {brand?.name} — match the reference images above.{' '}
                    {brand?.id && <Link href={`/brands/${brand.id}`} style={{ color: 'var(--accent)' }}>Open brand page →</Link>}
                  </div>
                )}
              </Card>

              {/* 2 — the deal. The id stays "making": the missing-field chips
                  and any link anyone has saved point at #making, and the price
                  and mechanic they name are both here. */}
              <Card id="making" title="The offer" purpose="Price anchor and the deal.">
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Price / anchor</div>
                  {p.retail_price ? (
                    // Verbatim, never parsed as a number: this field averages
                    // ~90 characters of prose, and "N/A — sitewide % off, no
                    // single anchor price" is a correct answer.
                    <div style={{ fontSize: 15, fontWeight: 600, maxWidth: '46ch', lineHeight: 1.5 }}>
                      <Clamp text={p.retail_price} lines={3} />
                    </div>
                  ) : (
                    <Missing tone="warn">No price anchor given — don&rsquo;t put a price on the ad.</Missing>
                  )}
                </div>

                {/* Was gridColumn '1 / -1' under a two-column grid that has
                    moved to the About card. The rule still earns its place —
                    there is a price above it — but the grid span would be
                    inert here. */}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    {p.offer_dynamics_type ? (
                      // Normalised on render — the column is free text, and
                      // BOGO / bogo / "Buy one get one" must not read as three
                      // different mechanics.
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', padding: '4px 10px', borderRadius: 6, background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                        {p.offer_dynamics_type.trim().toUpperCase()}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--urgent-soon)' }}>Mechanic not set — read it below.</span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
                      background: p.offer_locked ? 'var(--complete-bg)' : 'var(--stage-brief-bg)',
                      color: p.offer_locked ? 'var(--complete-text)' : 'var(--stage-brief-text)',
                    }}>{p.offer_locked ? 'Offer locked' : 'Not locked — may still change'}</span>
                  </div>
                  {p.offer && <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>{p.offer}</div>}
                  {p.offer_description && (
                    <div style={{ fontSize: 13, marginTop: 8, maxWidth: '80ch', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                      <Clamp text={p.offer_description} lines={4} />
                    </div>
                  )}
                </div>
              </Card>

              {/* 2 — the words */}
              {(hasAdCopy || hasLpCopy) && (
                <Card id="copy" title="What it says" purpose="Ad copy first, page copy below.">
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 12 }}>On the ad</div>
                  {hasAdCopy ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
                      {/* Headlines first — it's the line an editor picks before anything else. */}
                      {([['Headlines', p.ad_headlines], ['Subheadlines', p.ad_subcopies], ['Eyebrows', p.ad_eyebrows]] as const)
                        .filter(([, arr]) => arr && arr.length)
                        .map(([label, arr], col) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>{label} ({arr!.length})</div>
                            {/* Persistent, never hover-only: in a read-only screen
                                a hidden affordance is no affordance. */}
                            {col === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>click any line to copy</div>}
                            <div style={{ marginTop: col === 0 ? 0 : 6 }}>
                              {arr!.map((line, i) => <CopyLine key={`${line}-${i}`} text={line} />)}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    // Load-bearing sentence: the only copy the old Overview showed
                    // was landing-page copy, which is how LP copy ends up on ads.
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      No ad copy deck yet — the landing-page copy below is not ad copy.
                    </div>
                  )}

                  {hasLpCopy && (
                    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginTop: 20 }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 12 }}>Landing-page copy</div>
                      <Field label="Headline">{p.headline}</Field>
                      {p.body_copy && <Field label="Body copy"><Clamp text={p.body_copy} lines={6} /></Field>}
                      {p.supporting_message && <Field label="Supporting message"><Clamp text={p.supporting_message} lines={4} /></Field>}
                      {p.cta && (
                        <div>
                          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>CTA</div>
                          <span style={{ display: 'inline-block', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600 }}>{p.cta}</span>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {/* 3 — the look. Only the DNA fields that are actually populated:
                  the old section led with fonts (4-6 of 13 rows) and omitted
                  composition, mood, subject_matter and winning_hooks, which are
                  filled on all 13. */}
              {showLook && dna && (
                <Card id="look" title="How it should look" purpose="Brand DNA an editor draws from.">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
                    {LOOK_FIELDS.filter(([, v]) => !!v).map(([label, v]) => (
                      <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '12px 12px' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.55 }}><Clamp text={String(v)} lines={4} /></div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
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

                  {hooks.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                      {hooks.slice(0, 5).map(h => (
                        <span key={h} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>{h}</span>
                      ))}
                      {hooks.length > 5 && <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>+{hooks.length - 5} more</span>}
                    </div>
                  )}

                  {(p.competitor_reference || p.client_ad_inspiration) && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 16 }}>
                      {[p.competitor_reference, p.client_ad_inspiration].filter(Boolean).map((r, i) => (
                        <span key={i} style={{ marginRight: 12 }}>
                          {isUrl(r as string)
                            ? <a href={r as string} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{hostOf(r as string)} ↗</a>
                            : (r as string)}
                        </span>
                      ))}
                    </div>
                  )}

                  {(dna.primary_font || dna.secondary_font) && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                      Fonts · {dna.primary_font ?? '—'} / {dna.secondary_font ?? '—'}
                    </div>
                  )}
                </Card>
              )}

              {/* 4 — where it goes */}
              <Card id="destination" title="Where it goes" purpose="For the landing-page editor.">
                {p.page_type
                  ? <div style={{ fontSize: 15, fontWeight: 700 }}>{p.page_type}</div>
                  : <Missing tone="warn">No page type. An LP editor can&rsquo;t start.</Missing>}

                <div style={{ marginTop: 12 }}>
                  {p.lp_url ? (
                    <a href={p.lp_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>
                      {hostOf(p.lp_url)}<span style={{ color: 'var(--text-muted)' }}>{pathOf(p.lp_url)}</span> ↗
                    </a>
                  ) : p.is_complete ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No landing page URL.</div>
                  ) : (
                    // The "No LP URL" chip at the top lands here, so here is
                    // where the URL gets submitted — not a sentence about its absence.
                    <FinalOutputField field="lp_url" projectId={p.id} brandId={p.brand_id} currentValue={null} />
                  )}
                </div>

                {/* Present-only. motion_link is set on 2 of 66 projects and held a
                    permanent row on all 66. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                  {([['Drive folder ↗', p.drive_folder_url], ['Product assets ↗', p.product_images_link], ['Motion ↗', p.motion_link], ['Ad copy doc ↗', p.ad_copy_url]] as const)
                    .filter(([, href]) => !!href)
                    .map(([label, href]) => (
                      <a key={label} href={href as string} target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, fontWeight: 600, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none' }}>{label}</a>
                    ))}
                </div>
              </Card>
            </>
          )}

          {tab === 'lp' && (
            <>
              <NextStep
                projectId={p.id} brandId={p.brand_id}
                track="lp_stage" stage={p.lp_stage}
                label="Landing page" disabled={p.is_complete}
              />

              {/* Build-state, above the first card and deliberately not a card:
                  it must never become a nav destination. Three lock states, not
                  one alarm — 50 of 66 built pages sit on an unlocked offer, and
                  if every one of those shouted the shout stops meaning anything. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                {p.page_type
                  ? chip(p.page_type)
                  : <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--urgent-soon-bg)', color: 'var(--urgent-soon)' }}>No page type — the layout depends on it</span>}

                {p.offer_locked ? (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--complete-bg)', color: 'var(--complete-text)' }}>
                    Offer locked{lockedAt ? ` · ${lockedAt}` : ''}
                  </span>
                ) : p.lp_url ? (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--urgent-soon-bg)', color: 'var(--urgent-soon)' }}>
                    Offer not locked — this page is already built
                  </span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                    Offer not locked — copy can still change
                  </span>
                )}

                {p.lp_approved && !p.offer_locked && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'var(--urgent-soon-bg)', color: 'var(--urgent-soon)' }}>
                    Approved on an unlocked offer
                  </span>
                )}

                {lpOpen.length > 0 && (
                  <a
                    href="#feedback"
                    onClick={e => { e.preventDefault(); document.getElementById('feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px dashed var(--border-strong)', textDecoration: 'none' }}
                  >{lpOpen.length} open client note{lpOpen.length === 1 ? '' : 's'} ↓</a>
                )}
              </div>

              {/* 1 — the page, first: 60 of 66 already have one, so this is a
                  revision job far more often than a build. */}
              <Card id="page" title="Final output — landing page" purpose="The live page, and what's open on it.">
                {p.lp_url ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                    <a href={p.lp_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>
                      {hostOf(p.lp_url)}<span style={{ color: 'var(--text-muted)' }}>{pathOf(p.lp_url)}</span> ↗
                    </a>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
                      background: p.lp_approved ? 'var(--complete-bg)' : 'var(--surface-2)',
                      color: p.lp_approved ? 'var(--complete-text)' : 'var(--text-secondary)',
                      border: p.lp_approved ? 'none' : '1px solid var(--border)',
                    }}>{p.lp_approved ? 'Client approved' : 'Not yet approved'}</span>
                    {!p.is_complete && <FinalOutputField field="lp_url" projectId={p.id} brandId={p.brand_id} currentValue={p.lp_url} />}
                  </div>
                ) : (
                  <>
                    <Missing tone="muted">No page yet. This is a build, not a revision.</Missing>
                    {/* The submit box, right where the absence is announced. It
                        used to live only inside Edit details, which nobody
                        looked in for "where do I hand in the page". */}
                    {!p.is_complete && (
                      <div style={{ marginTop: 12 }}>
                        <FinalOutputField field="lp_url" projectId={p.id} brandId={p.brand_id} currentValue={null} />
                      </div>
                    )}
                  </>
                )}

                {p.lp_url && (
                  <div style={{ fontSize: 12, marginTop: 12 }}>
                    {lpComments.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>
                        No client comments. Work from the brief.
                      </span>
                    ) : (
                      <a
                        href="#feedback"
                        onClick={e => { e.preventDefault(); document.getElementById('feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                        style={{ color: lpOpen.length ? 'var(--accent)' : 'var(--success)', textDecoration: 'none' }}
                      >
                        {lpOpen.length
                          ? `${lpOpen.length} open · ${lpResolved.length} resolved →`
                          : `All ${lpResolved.length} resolved →`}
                      </a>
                    )}
                  </div>
                )}

                {/* The discount setup guide for the page, handed in alongside
                    the URL: free text on how the discount is configured in
                    Shopify (the column is still named shopify_coupon_code from
                    when it held a bare code). Also moved here from Edit details. */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Discount setup guide</div>
                  {p.shopify_coupon_code ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{
                        fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
                        padding: '10px 14px', borderRadius: 8, width: '100%',
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        maxWidth: '80ch',
                      }}>
                        {p.shopify_coupon_code}
                      </div>
                      {!p.is_complete && <FinalOutputField field="shopify_coupon_code" projectId={p.id} brandId={p.brand_id} currentValue={p.shopify_coupon_code} />}
                    </div>
                  ) : p.is_complete ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No discount setup guide.</div>
                  ) : (
                    <FinalOutputField field="shopify_coupon_code" projectId={p.id} brandId={p.brand_id} currentValue={null} />
                  )}
                </div>

                {p.lp_approved && !p.offer_locked && (
                  <div style={{ marginTop: 16 }}>
                    <Missing tone="warn">
                      Approved against an unlocked offer. Confirm it before shipping.
                    </Missing>
                  </div>
                )}

              </Card>

              {/* Every page built for this brand, so an LP editor can open what
                  was done last time instead of asking. Only when there is more
                  than one — a list of the page you are already looking at is not
                  a list. */}
              {brandLandingPages.length > 1 && (
                <Card id="library" title="Past pages for this brand" purpose="Newest first.">
                  {brandLandingPages.map((lp, i) => {
                    const mine = lp.id === p.id
                    return (
                      <div
                        key={lp.id}
                        style={{
                          display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 0',
                          borderBottom: i < brandLandingPages.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        <span style={{ flexShrink: 0, width: 62, fontSize: 11, color: 'var(--text-muted)' }}>
                          {lp.due_date ? new Date(lp.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: mine ? 700 : 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {/* The offer is what an LP editor recognises a page by
                                — not the project name, which is often the same
                                words every month. */}
                            <span>{lp.offer?.trim() || lp.name}</span>
                            {mine && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--accent-muted)', color: 'var(--accent)' }}>this project</span>}
                          </div>
                          {lp.lp_url && (
                            <a href={lp.lp_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                              {hostOf(lp.lp_url)}<span style={{ color: 'var(--text-muted)' }}>{pathOf(lp.lp_url)}</span> ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </Card>
              )}

              {/* 2 — the offer */}
              <Card id="offer" title="The offer" purpose="What this page sells.">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  {p.offer_dynamics_type ? (
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', padding: '4px 10px', borderRadius: 6, background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                      {p.offer_dynamics_type.trim().toUpperCase()}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Mechanic not set — read it below.</span>
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999,
                    background: p.offer_locked ? 'var(--complete-bg)' : 'var(--stage-brief-bg)',
                    color: p.offer_locked ? 'var(--complete-text)' : 'var(--stage-brief-text)',
                  }}>
                    {p.offer_locked
                      ? `Offer locked${lockedAt ? ` · ${lockedAt}` : ''}`
                      : 'Not locked — this offer can still change under a page that\u2019s already built'}
                  </span>
                </div>

                {p.offer ? (
                  <div style={{ marginTop: 12 }}>
                    <CopyLine text={p.offer} lead />
                  </div>
                ) : p.offer_description ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                    No one-line offer on file — the description below is the offer.
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <Missing tone="warn">No offer. Don&rsquo;t infer one.</Missing>
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  {p.retail_price
                    ? <Field label="Price / anchor — verbatim, don't reformat"><Clamp text={p.retail_price} lines={2} /></Field>
                    : <Missing tone="muted">No price anchor given — don&rsquo;t put a price on the page.</Missing>}
                </div>

                {p.offer_description && (
                  <div style={{ marginTop: 16 }}>
                    <Field label="How the offer works"><Clamp text={p.offer_description} lines={4} /></Field>
                  </div>
                )}
                {p.discount && <div style={{ marginTop: 8 }}><Field label="Discount">{p.discount}</Field></div>}
                {/* Rendered by the live page AND the public client review page;
                    the preview showed neither, so a tiered offer or a piece of
                    client inspiration simply vanished from the brief. */}
                {p.tiered_offer && <div style={{ marginTop: 8 }}><Field label="Tiered offer">{p.tiered_offer}</Field></div>}
                {p.inspiration && <div style={{ marginTop: 8 }}><Field label="Inspiration"><Clamp text={p.inspiration} lines={3} /></Field></div>}
              </Card>

              {/* 3 — the words, in the order they land on the page */}
              <Card id="copy" title="Page copy" purpose="In page order.">
                {!hasLpCopy ? (
                  // Bimodal in the data: 49 of 66 have all four blocks and 6 have
                  // none, so absence is written once rather than as four blanks.
                  <Missing tone="warn">
                    No page copy yet. Don&rsquo;t write your own.
                  </Missing>
                ) : (
                  <>
                    {p.headline && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Headline — first line on the page</div>
                        <CopyLine text={p.headline} />
                      </div>
                    )}

                    {p.body_copy && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Body — under the hero</div>
                        {/* CopyMarkdownButton, not CopyLine: 14 of 50 body values are
                            multi-paragraph and CopyLine's whiteSpace:normal would
                            collapse them into one run. */}
                        <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: '68ch' }}><Clamp text={p.body_copy} lines={8} /></div>
                        <CopyMarkdownButton markdown={() => p.body_copy ?? ''} label="Copy body copy" style={{ marginTop: 8 }} />
                      </div>
                    )}

                    {p.supporting_message && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Supporting line</div>
                        {supportPoisoned ? (
                          <>
                            <Missing tone="warn">
                              This field holds {p.supporting_message.length.toLocaleString()} characters — a pasted
                              meeting transcript, not page copy. Treat the supporting line as not written and ask for the real one.
                            </Missing>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, maxWidth: '68ch' }}>
                              {p.supporting_message.slice(0, 200)}…
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: '68ch' }}><Clamp text={p.supporting_message} lines={4} /></div>
                            <CopyMarkdownButton markdown={() => p.supporting_message ?? ''} label="Copy supporting line" style={{ marginTop: 8 }} />
                          </>
                        )}
                      </div>
                    )}

                    {p.cta && (
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Button label</div>
                        {p.cta.length > 40 ? (
                          <>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Alternates, not one label. Pick one.</div>
                            <CopyLine text={p.cta} />
                          </>
                        ) : (
                          // The pill is what the button will look like, and it is
                          // also the control — printing the label twice to make it
                          // copyable was the same string in two shapes.
                          <CtaPill text={p.cta} />
                        )}
                      </div>
                    )}

                    {lpCopyMissing.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
                        No {lpCopyMissing.join(' or ')} on file yet.
                      </div>
                    )}
                  </>
                )}
              </Card>

              {/* 4 — product. No hero image: that belongs to Overview, and firing
                  the loud "don't guess" state twice per project makes it wallpaper. */}
              {hasProduct && (
                <Card id="product" title="Product on the page" purpose="Check the right product.">
                  {skus.length === 1 && isUrl(skus[0]) ? (
                    <>
                      <a href={skus[0]} target="_blank" rel="noreferrer" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>Product page ↗</a>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>A link, not a name.</div>
                    </>
                  ) : skus.length === 1 ? (
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{skus[0]}</div>
                  ) : skus.length > 1 ? (
                    <>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>{skus.length} SKUs on this page</div>
                      {skus.map((sku, i) => (
                        <div key={sku} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                          <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 4, background: 'var(--surface-raised)', color: 'var(--text-secondary)', fontSize: 10, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{sku}</span>
                        </div>
                      ))}
                    </>
                  ) : null}

                  {p.product_description && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.6, maxWidth: '68ch' }}>
                      <Clamp text={p.product_description} lines={3} />
                    </div>
                  )}

                  {images.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                      {images.map((im, i) => (
                        <a key={im.id} href={im.storage_url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.storage_url} alt={`Reference ${i + 1}`} loading="lazy"
                            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                        </a>
                      ))}
                    </div>
                  ) : imageFallback ? (
                    <div style={{ fontSize: 12, marginTop: 16 }}>
                      <a href={imageFallback.href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{imageFallback.label}</a>
                    </div>
                  ) : null}
                </Card>
              )}

              {/* 5 — feedback */}
              {lpComments.length > 0 && (
                <Card id="feedback" title="Client feedback" purpose="Open items first.">
                  {/* The real panel: resolve toggles, per-asset grouping and pin
                      numbers. The preview's own grouping was read-only, so an
                      editor could see feedback here but only tick it off
                      somewhere else. */}
                  <ClientFeedbackPanel
                    // Same two sets the live page builds: client-audience only,
                    // and the creative track included. Passing [] for creatives
                    // meant image feedback never reached this panel at all, and
                    // passing unfiltered LP comments could show an internal note
                    // in a panel labelled Client feedback.
                    lpFeedback={clientLpFeedback}
                    creativeFeedback={clientCreativeFeedback}
                    assets={visibleAssets}
                    lpApproved={p.lp_approved}
                    creativesApproved={p.creatives_approved}
                    projectId={p.id}
                    brandId={p.brand_id}
                    canResolve
                  />

                </Card>
              )}

              {/* 6 — notes. The one place on this tab where CommentList's
                  Internal/Client dot carries information; above here every
                  comment is from the client. */}
              {/* The real thread, not a read-only list. It was rendered as
                  <CommentList>, which meant nobody could WRITE a note or mention
                  anyone — and it was gated on there already being notes, so on a
                  fresh project the section did not exist at all and there was
                  nowhere to start one. Always rendered now. */}
              <Card id="notes" title="Internal notes" purpose="Never seen by the client.">
                <NotesThread
                  notes={noteComments}
                  mode="internal"
                  projectId={p.id}
                  brandId={p.brand_id}
                  currentUserName={authorName}
                  currentUserId={currentUserId}
                  canDelete
                  mentionables={profiles.map(pr => ({ id: pr.id, name: profileName(pr) }))}
                />
              </Card>
            </>
          )}

          {tab === 'creatives' && (
            <>
              {brand?.id && (
                <BrandThread
                  brandId={brand.id}
                  brandName={brand.name}
                  projectId={p.id}
                  comments={brandComments}
                  currentUserId={currentUserId}
                  compact
                />
              )}

              {/* First thing on the tab, because it is the first thing an editor
                  does — nothing below works until the folder is synced. It was
                  behind a disclosure in the last card. */}
              <DriveSyncBar
                projectId={p.id}
                brandId={p.brand_id}
                folderUrl={p.drive_folder_url}
                assetCount={visibleAssets.length}
              />

              {/* The answer to "where do I submit my work". It used to be a
                  seven-step rail behind a disclosure called "Move a stage" —
                  a description of the data model, not an instruction. */}
              <NextStep
                projectId={p.id} brandId={p.brand_id}
                track="creatives_stage" stage={p.creatives_stage}
                label="Creatives" disabled={p.is_complete}
              />

              {/* One card, not three. Creative Brief, Copy Deck and Drive Folder
                  were separate sections for six rows, three arrays and a single
                  link — and the brief half of it reprinted Overview's product,
                  offer and price plus the header's own editor chip.

                  This tab is where the ad gets made, so the product is shown
                  rather than named: 23% of client revisions are "wrong product
                  shown", and an editor should not have to leave the tab they are
                  working on to see what they are drawing. */}
              <Card id="brief" title="Brief" purpose="What you're advertising.">
                <div style={{ display: 'grid', gridTemplateColumns: images.length ? 'auto minmax(0,1fr)' : '1fr', gap: 16, alignItems: 'start' }}>
                  {images.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 200 }}>
                      {images.map((im, i) => (
                        <a key={im.id} href={im.storage_url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.storage_url} alt={`Reference ${i + 1}`} loading="lazy"
                            style={{ width: 62, height: 62, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                        </a>
                      ))}
                    </div>
                  )}

                  <div>
                    {/* Names live in the Products card below — one place per fact,
                        or the two lists drift apart. */}
                    {p.offer && <div style={{ fontSize: 13, fontWeight: 600 }}>{p.offer}</div>}

                    {/* The full offer is an average of 985 characters and runs to
                        2,512 — a wall of text between an editor and the one thing
                        they need. Collapsed, with bullets on demand. */}
                    {p.offer_description && (
                      <div style={{ marginTop: 10 }}>
                        {shownSummary && (
                          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                              Summary — not ad copy
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {shownSummary.map((b, i) => (
                                <li key={i} style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 3 }}>{b}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <Disclosure title="Full offer" meta={`${p.offer_description.length.toLocaleString()} characters`}>
                          <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: '80ch', whiteSpace: 'pre-wrap' }}>{p.offer_description}</div>
                        </Disclosure>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <button
                            disabled={summarising}
                            onClick={async () => {
                              setSummarising(true); setSummaryErr('')
                              try {
                                const r = await summariseProjectOffer(p.id, p.brand_id)
                                if (r.ok) setSummary(r.bullets); else setSummaryErr(r.error)
                              } catch (e) {
                                setSummaryErr(e instanceof Error ? e.message : 'Could not summarise.')
                              } finally { setSummarising(false) }
                            }}
                            style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 11px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'none', color: 'var(--text-secondary)', cursor: summarising ? 'wait' : 'pointer' }}
                          >
                            {summarising ? 'Summarising…' : shownSummary ? 'Re-summarise' : '✦ Simplify with AI'}
                          </button>
                          {summaryStale && !summary && (
                            <span style={{ fontSize: 11, color: 'var(--urgent-soon)' }}>Offer changed. Re-summarise.</span>
                          )}
                          {summaryErr && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{summaryErr}</span>}
                        </div>
                      </div>
                    )}

                    {p.retail_price
                      ? <div style={{ marginTop: 10 }}><Field label="Price / anchor — verbatim"><Clamp text={p.retail_price} lines={2} /></Field></div>
                      : <div style={{ marginTop: 10 }}><Missing tone="warn">No price anchor given — don&rsquo;t put a price on the ad.</Missing></div>}

                    {images.length === 0 && imageFallback && (
                      <div style={{ marginTop: 10 }}>
                        <a href={imageFallback.href} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>{imageFallback.label}</a>
                      </div>
                    )}
                  </div>
                </div>

                {(p.competitor_reference || p.client_ad_inspiration) && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginRight: 8 }}>References</span>
                    {[p.competitor_reference, p.client_ad_inspiration].filter(Boolean).map((r, i) => (
                      <span key={i} style={{ marginRight: 12 }}>
                        {isUrl(r as string)
                          ? <a href={r as string} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{hostOf(r as string)} ↗</a>
                          : (r as string)}
                      </span>
                    ))}
                  </div>
                )}

                {/* A link, not a section of its own. */}
                {p.drive_folder_url && (
                  <div style={{ marginTop: 16 }}>
                    <a href={p.drive_folder_url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, fontWeight: 600, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', textDecoration: 'none' }}>Final output — Drive ↗</a>
                  </div>
                )}
              </Card>

              {brand?.id && (
                <BrandGuidelines
                  brandId={brand.id}
                  brandName={brand.name}
                  projectId={p.id}
                  guidelines={brand.brand_guidelines ?? null}
                  documents={brandDocuments}
                  collapsed
                  key={`c:${brand.id}`}
                />
              )}

              {/* Brand DNA, collapsed. It is reference material an editor consults
                  rather than reads every visit, and the Overview already renders
                  it open. Only the fields that are actually populated — the DNA
                  table's fonts run 4-6 of 13 while composition, mood and
                  subject_matter are filled on all 13. */}
              {showLook && dna && (
                <Disclosure title="Brand DNA" meta={`${LOOK_FIELDS.length} field${LOOK_FIELDS.length === 1 ? '' : 's'}`}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
                    {LOOK_FIELDS.map(([label, v]) => (
                      <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '12px 12px' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 13, lineHeight: 1.55 }}><Clamp text={String(v)} lines={4} /></div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
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

                  {hooks.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      {hooks.slice(0, 5).map(h => (
                        <span key={h} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>{h}</span>
                      ))}
                      {hooks.length > 5 && <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>+{hooks.length - 5} more</span>}
                    </div>
                  )}

                  {(dna.primary_font || dna.secondary_font) && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12 }}>
                      Fonts · {dna.primary_font ?? '—'} / {dna.secondary_font ?? '—'}
                    </div>
                  )}
                </Disclosure>
              )}

              {/* Every product, its page, and where the hi-res photography lives.
                  This is the answer to the most common revision on the system:
                  23% of client comments are "wrong product shown", and until now
                  an editor working on the third of eight SKUs had nowhere to read
                  its link. */}
              <Card id="products" title="Products in this project" purpose="Name, link, HQ assets.">
                {editing === 'products' ? (
                  <ProductGroupEditor
                    projectId={p.id} brandId={p.brand_id}
                    initial={products}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <>
                    {drifted && (
                      <div style={{ fontSize: 11, color: 'var(--urgent-soon)', marginBottom: 12 }}>
                        The brief&rsquo;s product text was edited elsewhere and no longer matches this list. Saving here overwrites it.
                      </div>
                    )}

                    {products.length === 0 ? (
                      <Missing tone="warn">No products. Add them, or read them from the brief.</Missing>
                    ) : (
                      grouped.map(({ group, items }) => (
                        <div key={group ?? '__none'} style={{ marginBottom: 20 }}>
                          {/* A group header only where there IS a group. On a flat
                              project this renders exactly as it did before. */}
                          {group && (
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', marginBottom: 6 }}>
                              {group} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {items.length}</span>
                            </div>
                          )}
                          {grouped.some(g => g.group) && !group && (
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                              Not in a group · {items.length}
                            </div>
                          )}
                          <div style={{ paddingLeft: group ? 12 : 0, borderLeft: group ? '2px solid var(--border)' : 'none' }}>
                            {items.map((prod, i) => (
                              <div key={prod.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 4, background: 'var(--surface-raised)', color: 'var(--text-secondary)', fontSize: 10, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                                {/* contain, not cover — a cropped product is the
                                    thing this whole tab exists to prevent. */}
                                {prod.image_url ? (
                                  <a href={prod.url ?? prod.image_url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={prod.image_url} alt={prod.name} loading="lazy"
                                      style={{ width: 44, height: 44, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                                  </a>
                                ) : (
                                  <span style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 6, background: 'var(--surface-2)', border: '1px dashed var(--border)' }} />
                                )}
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{isUrl(prod.name) ? hostOf(prod.name) : prod.name}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 3 }}>
                                    {prod.url && (
                                      <a href={prod.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                                        {hostOf(prod.url)}<span style={{ color: 'var(--text-muted)' }}>{pathOf(prod.url)}</span> ↗
                                      </a>
                                    )}
                                    {prod.assets_url && (
                                      <a href={prod.assets_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>HQ assets ↗</a>
                                    )}
                                    {!prod.url && !prod.assets_url && (
                                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        No link yet ·{' '}
                                        <button onClick={() => setEditing('products')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Add link</button>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                      <button onClick={() => setEditing('products')} style={editBtn}>{products.length ? 'Edit products & groups' : 'Add products'}</button>
                      {products.some(x => x.url) && (
                        <button
                          disabled={thumbing}
                          onClick={async () => {
                            setThumbing(true); setThumbNote('')
                            try {
                              const r = await fetchProductThumbnails(p.id, p.brand_id)
                              setThumbNote(r.ok
                                ? `${r.found} of ${r.checked} found${r.skipped ? ` · ${r.skipped} link${r.skipped === 1 ? '' : 's'} point at a collection, not a product` : ''}`
                                : r.error)
                            } catch (e) {
                              setThumbNote(e instanceof Error ? e.message : 'Could not fetch thumbnails.')
                            } finally { setThumbing(false) }
                          }}
                          style={editBtn}
                        >{thumbing ? 'Fetching…' : '⟳ Get thumbnails'}</button>
                      )}
                    </div>
                    {thumbNote && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>{thumbNote}</div>}

                    {/* Folders covering the whole job — the client's Air
                        workspace, a Cloudinary collection, raw photography,
                        a font pack. Previously one read-only column pretending
                        to be a list. */}
                    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                        Folders — whole project, not one product
                      </div>

                      {editing === 'folders' ? (
                        <ListEditor
                          projectId={p.id} brandId={p.brand_id} kind="asset_folders"
                          rows={assetFolders.map(f => ({ id: f.id, name: f.label, a: f.url ?? '', b: '' })) as ListRow[]}
                          labels={{ name: 'What it is', a: 'Folder link', b: '', add: 'Add folder' }}
                          onDone={() => setEditing(null)}
                        />
                      ) : (
                        <>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: assetFolders.length || p.product_images_link || p.drive_folder_url ? 10 : 0 }}>
                            {assetFolders.map(f => (
                              f.url
                                ? <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>{f.label} ↗</a>
                                : <span key={f.id} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.label} — no link</span>
                            ))}
                            {/* The two that predate this list, still written elsewhere. */}
                            {p.product_images_link && <a href={p.product_images_link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>Product photos ↗</a>}
                            {p.drive_folder_url && <a href={p.drive_folder_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>Final output — Drive ↗</a>}
                          </div>
                          <button onClick={() => setEditing('folders')} style={editBtn}>
                            {assetFolders.length ? 'Edit folders' : 'Add a folder'}
                          </button>
                        </>
                      )}
                    </div>

                    {/* The whole set at a glance. The 44px thumbnails in the rows
                        are an identity check while you read a line; this is for
                        recognising the products as a group before you start —
                        which is the thing a 44px square cannot do. Ordered and
                        grouped the same as the list above, so the two never
                        disagree about what is in a bundle. */}
                    {products.some(x => x.image_url) && (
                      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
                          Everything in this project
                        </div>
                        {grouped.map(({ group, items }) => {
                          const shown = items.filter(x => x.image_url)
                          if (!shown.length) return null
                          return (
                            <div key={group ?? '__none'} style={{ marginBottom: 16 }}>
                              {grouped.some(g => g.group) && (
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: group ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 8 }}>
                                  {group ?? 'Not in a group'}
                                </div>
                              )}
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 12 }}>
                                {shown.map(prod => (
                                  <a
                                    key={prod.id}
                                    href={prod.url ?? prod.image_url ?? '#'}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={prod.name}
                                    style={{ textDecoration: 'none', color: 'inherit' }}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={prod.image_url!}
                                      alt={prod.name}
                                      loading="lazy"
                                      style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}
                                    />
                                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.35 }}>{prod.name}</div>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </Card>

              {/* Two lists, deliberately not one. The client's own winners and a
                  competitor's report answer different questions, and mixing them
                  would file our own client under "Competitors". */}
              <Card id="motion" title="Motion reports" purpose="Ours, then theirs.">
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  Top performers
                </div>

                {/* The project's own working board, if one is set on the live
                    page's deliverable form. Distinct from a top-performer report. */}
                {p.motion_link && (
                  <div style={{ padding: '8px 12px', marginBottom: 10, borderRadius: 8, background: 'var(--surface-2)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>This project&rsquo;s Motion board</div>
                    <a href={p.motion_link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>Open board ↗</a>
                  </div>
                )}

                {editing === 'top' ? (
                  <ListEditor
                    projectId={p.id} brandId={p.brand_id} kind="top_performers"
                    rows={topPerformers.map(x => ({ id: x.id, name: x.name, a: x.motion_url ?? '', b: x.link ?? '' })) as ListRow[]}
                    labels={{ name: 'What it is', a: 'Motion report link', b: 'Other link (optional)', add: 'Add top performer' }}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <>
                    {topPerformers.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Empty.</div>
                    ) : (
                      topPerformers.map((t, i) => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: i < topPerformers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 3 }}>
                              {t.motion_url && <a href={t.motion_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>Motion report ↗</a>}
                              {t.link && <a href={t.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>{hostOf(t.link)} ↗</a>}
                              {!t.motion_url && !t.link && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No link yet</span>}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    <div style={{ marginTop: 12 }}>
                      <button onClick={() => setEditing('top')} style={editBtn}>{topPerformers.length ? 'Edit top performers' : 'Add top performer'}</button>
                    </div>
                  </>
                )}

                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginTop: 28, marginBottom: 10, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  Competitors
                </div>

                {editing === 'competitors' ? (
                  <ListEditor
                    projectId={p.id} brandId={p.brand_id} kind="competitors"
                    rows={competitors.map(x => ({ id: x.id, name: x.name, a: x.site_url ?? '', b: x.motion_url ?? '' })) as ListRow[]}
                    labels={{ name: 'Competitor', a: 'Their site', b: 'Motion report link', add: 'Add competitor' }}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <>
                    {competitors.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Empty.</div>
                    ) : (
                      competitors.map((c, i) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: i < competitors.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 3 }}>
                              {c.site_url && <a href={c.site_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>{hostOf(c.site_url)} ↗</a>}
                              {c.motion_url
                                ? <a href={c.motion_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>Motion report ↗</a>
                                : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    No Motion report yet ·{' '}
                                    <button onClick={() => setEditing('competitors')} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Add report</button>
                                  </span>}
                            </div>
                          </div>
                        </div>
                      ))
                    )}

                    <div style={{ marginTop: 12 }}>
                      <button onClick={() => setEditing('competitors')} style={editBtn}>{competitors.length ? 'Edit competitors' : 'Add competitor'}</button>
                    </div>

                    {p.competitor_reference && (
                      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                          From the brief — not yet split into rows
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '80ch' }}>
                          <Clamp text={p.competitor_reference} lines={3} />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Card>

              {/* Copy, in the order an editor picks it, and liftable. It used to
                  be a plain list on the one tab where the words actually get
                  used, so every line was retyped by hand.

                  Rendered whether or not copy exists. Gated on hasAdCopy, the
                  card and its nav entry vanished from a project with no copy —
                  so the one moment you actually need "add copy" was the one
                  moment there was nowhere to click. 14 of 52 active projects
                  were in that state. Empty, it opens straight into the editor
                  with Generate beside it. */}
              <Card id="copy" title="Copy deck" purpose={hasAdCopy ? "Tick what's approved." : 'Write it, or generate a first pass.'}>
                {!hasAdCopy && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
                    No copy on this project yet. Type the lines below, or hit{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>✦ Generate Copy</strong> to draft headlines,
                    subheadlines and eyebrows from the offer — then edit what it gives you.
                  </div>
                )}
                {hasAdCopy && (
                  <CopyApprovalDeck
                    // Same reason as BrandBrief: the tick/cross draft is seeded
                    // once at mount, so it must be rebuilt when the saved
                    // verdicts or the copy lines themselves change.
                    key={`${(p.ad_headlines ?? []).length}:${(p.ad_subcopies ?? []).length}:${(p.ad_eyebrows ?? []).length}:${copyApprovals.lines.length}:${copyApprovals.log[0]?.at ?? ''}`}
                    projectId={p.id}
                    brandId={p.brand_id}
                    approvals={copyApprovals}
                    columns={[
                      { label: 'Headlines', lines: p.ad_headlines ?? [] },
                      { label: 'Subheadlines', lines: p.ad_subcopies ?? [] },
                      { label: 'Eyebrows', lines: p.ad_eyebrows ?? [] },
                    ]}
                  />
                )}

                {/* Once there IS copy, editing goes back behind a disclosure:
                    the columns above are what an editor uses 95% of the time —
                    lifting a line, not rewriting the deck. With nothing there,
                    a collapsed "edit" link is just a second click in front of
                    the only thing you can do. */}
                {hasAdCopy ? (
                  <details style={{ marginTop: 16 }}>
                    <summary style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>Edit or generate copy</summary>
                    <div style={{ marginTop: 12 }}>
                      <CopyDeckPanel
                        projectId={p.id}
                        brandId={p.brand_id}
                        initialHeadlines={p.ad_headlines ?? []}
                        initialEyebrows={p.ad_eyebrows ?? []}
                        initialSubcopies={p.ad_subcopies ?? []}
                        hypercareContact={hypercareRule ? hypercareCopyMessage(hypercareRule) : null}
                      />
                    </div>
                  </details>
                ) : (
                  <CopyDeckPanel
                    projectId={p.id}
                    brandId={p.brand_id}
                    initialHeadlines={p.ad_headlines ?? []}
                    initialEyebrows={p.ad_eyebrows ?? []}
                    initialSubcopies={p.ad_subcopies ?? []}
                    hypercareContact={hypercareRule ? hypercareCopyMessage(hypercareRule) : null}
                  />
                )}
              </Card>

              <Card id="review" title="Review" purpose="Approve, fix, and publish.">
                {/* The old "Open internal review" banner lived here. Gallery
                    View replaces the reason for it — a big image at full
                    viewport, without leaving the tab. /internal-review is still
                    the only screen with pin annotations, so ReviewWorkspace
                    links to it from inside the Gallery rail instead. */}
                <ReviewWorkspace projectId={p.id} brandId={p.brand_id} assets={visibleAssets} comments={creativeComments} revisionsByAsset={revisionsByAsset} authorName={authorName} currentUserId={currentUserId} />

                {/* Bulk publish, purge, archive. Syncing moved to the bar at the
                    top of the tab — this panel carries its own folder input too,
                    but the bar is the one an editor should find, so the label
                    here no longer advertises it. */}
                <details style={{ marginTop: 20 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>Bulk actions &amp; archive</summary>
                  <div style={{ marginTop: 12 }}>
                    <CreativeAssetsManager
                      projectId={p.id}
                      brandId={p.brand_id}
                      initialFolderUrl={p.drive_folder_url}
                      initialAssets={assets}
                      imageComments={creativeComments}
                    />
                  </div>
                </details>

                {/* Which Meta campaigns these creatives went live in. Without it
                    the Results pipeline has no link back to the project. */}
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>Campaign tracking</summary>
                  <div style={{ marginTop: 12 }}>
                    <CampaignTrackingPanel projectId={p.id} brandId={p.brand_id} campaigns={campaigns} todayIso={todayIso} canEdit />
                  </div>
                </details>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Lifecycle, last and quiet — out of the working path. Completing is
          reversible and archival; deleting is neither, so it stays behind its
          own disclosure. */}
      <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        {!p.is_complete && p.lp_stage === 'live' && p.creatives_stage === 'live' && (
          <form action={markProjectComplete.bind(null, p.id, p.brand_id)} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, maxWidth: '60ch' }}>
              Both tracks are live. Marking complete archives the project and surfaces its deliverables — nothing is deleted.
            </div>
            <SubmitButton
              pendingText="Marking complete…"
              style={{ background: 'var(--complete)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Mark complete
            </SubmitButton>
          </form>
        )}

        <details>
          <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Delete this project</summary>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, maxWidth: '60ch' }}>
              Permanent. Deletes the project and everything attached to it — creatives, comments, revisions.
            </div>
            {/* The same confirm the live page uses. A disclosure is not a
                confirmation: it hides the button, it does not ask. */}
            <ConfirmDeleteForm
              action={deleteProject.bind(null, p.id, p.brand_id)}
              message={`Delete "${p.name}"? This cannot be undone.`}
            >
              <button type="submit" style={{ background: 'none', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Delete permanently
              </button>
            </ConfirmDeleteForm>
          </div>
        </details>
      </div>
    </div>
  )
}

const editBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer',
}
