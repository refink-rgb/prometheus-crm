// Markdown export for briefs, offers and the pipeline.
//
// One shape everywhere: "**Field name:** value", grouped under headings.
// Empty fields are dropped rather than emitted blank — the point of these
// buttons is to paste a brief into Slack, Notion or a doc without then having
// to delete twenty "Field: —" lines by hand.
//
// Pure functions, no React: usable from server components (project brief) and
// client components (offer detail, pipeline table) alike.

import {
  OFFER_STAGE_LABELS, STAGE_LABELS, normalizeStage, offerMonthLabel,
  type BrandDna, type OfferCard, type Project,
} from './types'
import type { OfferHistoryEntry } from './offer-history'

export type MdField = { label: string; value: unknown }
export type MdSection = { heading?: string; fields: MdField[] }

/**
 * Is this worth writing down? Null, empty strings, whitespace, empty arrays and
 * `false` all mean "nothing here". `false` counts as empty on purpose: these
 * fields read as flags ("Needs revisions"), and listing the ones that are off
 * is noise in a document meant to be skimmed.
 */
function hasValue(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.some(hasValue)
  return true
}

function renderValue(v: unknown): string {
  if (v === true) return 'Yes'
  if (Array.isArray(v)) {
    const items = v.filter(hasValue).map(item => `- ${String(item).trim()}`)
    return `\n${items.join('\n')}`
  }
  const s = String(v).trim()
  // Multi-line text (offer descriptions, guardrails, approval messages) reads
  // badly inline after a bold label — break it onto its own lines.
  return s.includes('\n') ? `\n\n${s}` : s
}

export function buildMarkdown(
  title: string,
  sections: MdSection[],
  subtitle?: string,
): string {
  const out: string[] = [`# ${title}`]
  if (subtitle?.trim()) out.push(`_${subtitle.trim()}_`)

  for (const section of sections) {
    const present = section.fields.filter(f => hasValue(f.value))
    if (present.length === 0) continue
    if (section.heading) out.push(`## ${section.heading}`)
    out.push(present.map(f => {
      const rendered = renderValue(f.value)
      // Block values (lists, multi-line text) already start with a newline —
      // a separating space there would leave trailing whitespace on the label.
      return `**${f.label}:**${rendered.startsWith('\n') ? '' : ' '}${rendered}`
    }).join('\n\n'))
  }

  return `${out.join('\n\n')}\n`
}

/** 'Aug 14, 2026' — dates are formatted UTC so a stored date never shifts a day. */
function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}

// --- Production brief ---------------------------------------------------------

export function projectBriefMarkdown(
  p: Project,
  meta: { brandName?: string | null; journeyName?: string | null; lpEditor?: string | null; creativeEditor?: string | null } = {},
): string {
  return buildMarkdown(p.name, [
    {
      fields: [
        { label: 'Brand', value: meta.brandName ?? p.brand?.name ?? null },
        { label: 'Journey', value: meta.journeyName ?? p.journey?.name ?? null },
        { label: 'Marketing Moment', value: p.marketing_moment ? `M${p.marketing_moment}` : null },
        { label: 'Landing Page Stage', value: STAGE_LABELS[normalizeStage(p.lp_stage)] },
        { label: 'Creatives Stage', value: STAGE_LABELS[normalizeStage(p.creatives_stage)] },
        { label: 'Launch Date', value: fmtDate(p.due_date) },
        { label: 'Complete', value: p.is_complete },
        { label: 'Needs Revisions', value: p.needs_revisions },
      ],
    },
    {
      heading: 'Stage Targets',
      fields: [
        { label: 'Brief', value: fmtDate(p.stage_brief_due_date) },
        { label: 'In Progress', value: fmtDate(p.stage_in_progress_due_date) },
        { label: 'Internal Review', value: fmtDate(p.stage_internal_review_due_date) },
        { label: 'Client Review', value: fmtDate(p.stage_client_review_due_date) },
      ],
    },
    {
      heading: 'Team',
      fields: [
        { label: 'Landing Page Editor', value: meta.lpEditor },
        { label: 'Creative Editor', value: meta.creativeEditor },
      ],
    },
    {
      heading: 'The Offer',
      fields: [
        { label: 'Offer Dynamics', value: p.offer_dynamics_type },
        { label: 'Offer Dynamics Detail', value: p.offer_dynamics_detail },
        { label: 'Offer', value: p.offer },
        { label: 'Offer Description', value: p.offer_description },
        { label: 'Discount', value: p.discount },
        { label: 'Tiered Offer', value: p.tiered_offer },
        { label: 'Shopify Coupon Code', value: p.shopify_coupon_code },
        { label: 'Offer Locked', value: p.offer_locked },
      ],
    },
    {
      heading: 'Product',
      fields: [
        { label: 'Product Featured', value: p.product_featured },
        { label: 'Product Description', value: p.product_description },
        { label: 'Retail Price', value: p.retail_price },
        { label: 'Page Type', value: p.page_type },
        { label: 'Target Audience', value: p.target_audience },
      ],
    },
    {
      heading: 'Landing Page Copy',
      fields: [
        { label: 'Hero Headline', value: p.headline },
        { label: 'Body Copy', value: p.body_copy },
        { label: 'Supporting Message', value: p.supporting_message },
        { label: 'CTA', value: p.cta },
      ],
    },
    {
      heading: 'Creative Brief',
      fields: [
        { label: 'Competitor Reference', value: p.competitor_reference },
        { label: 'Client Ad Inspiration', value: p.client_ad_inspiration },
        { label: 'Inspiration', value: p.inspiration },
      ],
    },
    {
      heading: 'Meta Ad Copy',
      fields: [
        { label: 'Primary Text', value: p.ad_copy_primary_text },
        { label: 'Description', value: p.ad_copy_description },
        { label: 'URL', value: p.ad_copy_url },
      ],
    },
    {
      heading: 'Copy Deck',
      fields: [
        { label: 'Headlines', value: p.ad_headlines },
        { label: 'Eyebrows', value: p.ad_eyebrows },
        { label: 'Subcopies', value: p.ad_subcopies },
      ],
    },
    {
      heading: 'Links',
      fields: [
        { label: 'Landing Page URL', value: p.lp_url },
        { label: 'Drive Folder', value: p.drive_folder_url },
        { label: 'Motion Link', value: p.motion_link },
        { label: 'Product Images', value: p.product_images_link },
      ],
    },
    {
      heading: 'Notes',
      fields: [
        { label: 'Notes', value: p.notes },
        { label: 'Creative Notes', value: p.creatives_notes },
      ],
    },
  ], meta.brandName ?? p.brand?.name ?? undefined)
}

// --- Offer card ---------------------------------------------------------------

// Everything the LP team reads off a Brand DNA when they build from an offer:
// the strategic fields the offer workspace already shows, plus the visual
// system (type, color, CTA, photography) a page has to honour. A superset of
// what offerCardMarkdown needs, so one fetch feeds both exports.
export type OfferBriefDna = Pick<BrandDna,
  | 'tagline'
  | 'positioning'
  | 'voice_adjectives'
  | 'competitive_differentiation'
  | 'core_value_prop'
  | 'top_pain_points'
  | 'proof_points'
  | 'common_offers'
  | 'price_anchor'
  | 'top_objections'
  | 'winning_hooks'
  | 'offer_presentation'
  | 'logo_url'
  | 'primary_font'
  | 'secondary_font'
  | 'headline_weight'
  | 'body_weight'
  | 'primary_color'
  | 'secondary_color'
  | 'accent_color'
  | 'background_colors'
  | 'contrast_color'
  | 'cta_style'
  | 'lighting'
  | 'color_grading'
  | 'composition'
  | 'subject_matter'
  | 'props_and_surfaces'
  | 'mood'
  | 'packaging_description'
  | 'text_overlay_style'
  | 'ugc_usage'
>

// The production card spawned from the offer, as far as the LP brief cares:
// the launch date, the per-stage targets and the links the team works from.
export type OfferBriefProduction = Pick<Project,
  | 'id'
  | 'name'
  | 'due_date'
  | 'stage_brief_due_date'
  | 'stage_in_progress_due_date'
  | 'stage_internal_review_due_date'
  | 'stage_client_review_due_date'
  | 'moment_code'
  | 'lp_url'
  | 'drive_folder_url'
  | 'product_images_link'
  | 'shopify_coupon_code'
>

export interface OfferMarkdownContext {
  brandName?: string | null
  website?: string | null
  brandNotes?: string | null
  // The client's own rules, pasted on the brand page. Distinct from brandNotes
  // (ours). Only the LP brief emits it; the offer export never did.
  brandGuidelines?: string | null
  growthStrategist?: string | null
  profitEngineer?: string | null
  dna?: Partial<OfferBriefDna> | null
  production?: OfferBriefProduction | null
  history?: OfferHistoryEntry[]
}

export function offerCardMarkdown(
  card: OfferCard,
  ownerName?: string | null,
  context: OfferMarkdownContext = {},
): string {
  const brandName = context.brandName ?? card.brand?.name ?? null
  const base = buildMarkdown(card.name, [
    {
      fields: [
        { label: 'Brand', value: brandName },
        { label: 'Target Month', value: offerMonthLabel(card.target_month) },
        { label: 'Moment', value: `M${card.moment_slot}` },
        { label: 'Stage', value: OFFER_STAGE_LABELS[card.stage] },
        { label: 'Owner', value: ownerName },
      ],
    },
    {
      heading: 'Strategy',
      fields: [
        { label: 'Problem Statement', value: card.problem_statement },
        { label: 'Success Metric', value: card.success_metric },
        { label: 'Success Target', value: card.success_target },
      ],
    },
    {
      heading: 'Offer Mechanics',
      fields: [
        { label: 'Offer Dynamics', value: card.offer_dynamics_type },
        { label: 'Offer', value: card.offer },
        { label: 'Offer Description', value: card.offer_description },
        { label: 'Guardrails', value: card.guardrails },
      ],
    },
    {
      heading: 'Product',
      fields: [
        { label: 'Product Featured', value: card.product_featured },
        { label: 'Product Description', value: card.product_description },
        { label: 'Retail Price', value: card.retail_price },
        { label: 'Page Type', value: card.page_type },
      ],
    },
    {
      heading: 'Message & Creative',
      fields: [
        { label: 'Competitor Reference', value: card.competitor_reference },
        { label: 'Client Ad Inspiration', value: card.client_ad_inspiration },
        { label: 'Product Images', value: card.product_images_link },
      ],
    },
    {
      heading: 'Brand Context',
      fields: [
        { label: 'Website', value: context.website },
        { label: 'Account Notes', value: context.brandNotes },
        { label: 'Tagline', value: context.dna?.tagline },
        { label: 'Positioning', value: context.dna?.positioning },
        { label: 'Core Value Proposition', value: context.dna?.core_value_prop },
        { label: 'Competitive Differentiation', value: context.dna?.competitive_differentiation },
        { label: 'Top Pain Points', value: context.dna?.top_pain_points },
        { label: 'Brand Proof Points', value: context.dna?.proof_points },
        { label: 'Common Offers', value: context.dna?.common_offers },
        { label: 'Price Anchor', value: context.dna?.price_anchor },
        { label: 'Top Objections', value: context.dna?.top_objections },
        { label: 'Winning Hooks', value: context.dna?.winning_hooks },
        { label: 'Offer Presentation', value: context.dna?.offer_presentation },
      ],
    },
    {
      heading: 'Client Approval Message',
      fields: [
        { label: 'Message', value: card.client_approval_message },
      ],
    },
  ], brandName ?? undefined)

  if (!context.history?.length) return base

  return `${base}\n## Brand Offer History\n\n${offerHistoryTable(context.history)}\n`
}

// --- LP brief -------------------------------------------------------------------
//
// The handoff document for the landing page team: everything they need to
// build the page, and nothing they must not touch. Deliberately EXCLUDES the
// client approval message (that is for the client), the internal/client
// sign-off trail, and every copy field (headline, body, CTA, ad copy live on
// the production card and are written by the copy team, not handed down).
// What it ADDS over the offer export: the client's brand guidelines, the
// Brand DNA visual system, the production timeline and the working links.

function colorList(values: Array<string | null | undefined> | null | undefined): string[] | null {
  if (!values) return null
  const present = values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return present.length ? present : null
}

export function offerLpBriefMarkdown(
  card: OfferCard,
  ownerName?: string | null,
  context: OfferMarkdownContext = {},
): string {
  const brandName = context.brandName ?? card.brand?.name ?? null
  const dna = context.dna ?? null
  const prod = context.production ?? null
  const momentLabel = `${offerMonthLabel(card.target_month)} · M${card.moment_slot}`
  const title = card.offer?.trim()
    ? `${brandName ?? 'Brand'} · ${card.offer.trim()}`
    : card.name
  const successTarget = card.success_target === null || card.success_target === undefined
    ? null
    : `${card.success_target}`

  const base = buildMarkdown(title, [
    {
      fields: [
        { label: 'Brand', value: brandName },
        { label: 'Website', value: context.website },
        { label: 'Moment', value: momentLabel },
        { label: 'Page Type', value: card.page_type },
        { label: 'Offer Owner', value: ownerName },
        { label: 'Growth Strategist', value: context.growthStrategist },
        { label: 'Profit Engineer', value: context.profitEngineer },
        { label: 'Moment Code', value: prod?.moment_code },
      ],
    },
    {
      heading: 'Timeline',
      fields: [
        { label: 'Launch (live)', value: fmtDate(prod?.due_date) },
        { label: 'Brief due', value: fmtDate(prod?.stage_brief_due_date) },
        { label: 'Build due', value: fmtDate(prod?.stage_in_progress_due_date) },
        { label: 'Internal review due', value: fmtDate(prod?.stage_internal_review_due_date) },
        { label: 'Client review due', value: fmtDate(prod?.stage_client_review_due_date) },
      ],
    },
    {
      heading: 'Why This Offer',
      fields: [
        { label: 'Problem we are solving', value: card.problem_statement },
        { label: 'Success metric', value: card.success_metric },
        { label: 'Success target', value: successTarget },
        { label: 'Guardrails', value: card.guardrails },
      ],
    },
    {
      heading: 'The Offer',
      fields: [
        { label: 'Offer dynamics', value: card.offer_dynamics_type },
        { label: 'Offer', value: card.offer },
        { label: 'Full mechanics', value: card.offer_description },
        { label: 'Coupon code', value: prod?.shopify_coupon_code },
      ],
    },
    {
      heading: 'Product',
      fields: [
        { label: 'Product featured', value: card.product_featured },
        { label: 'Product context', value: card.product_description },
        { label: 'Retail price', value: card.retail_price },
        { label: 'Product images', value: card.product_images_link ?? prod?.product_images_link },
      ],
    },
    {
      heading: 'Inspiration & References',
      fields: [
        { label: 'Reference pages and competitors', value: card.competitor_reference },
        { label: 'Client ad inspiration and creative rules', value: card.client_ad_inspiration },
      ],
    },
    {
      heading: 'Brand Context',
      fields: [
        { label: 'Account notes', value: context.brandNotes },
        { label: 'Tagline', value: dna?.tagline },
        { label: 'Positioning', value: dna?.positioning },
        { label: 'Voice', value: dna?.voice_adjectives },
        { label: 'Core value proposition', value: dna?.core_value_prop },
        { label: 'Competitive differentiation', value: dna?.competitive_differentiation },
        { label: 'Top pain points', value: dna?.top_pain_points },
        { label: 'Proof points', value: dna?.proof_points },
        { label: 'Top objections', value: dna?.top_objections },
        { label: 'Winning hooks', value: dna?.winning_hooks },
        { label: 'Common offers', value: dna?.common_offers },
        { label: 'Price anchor', value: dna?.price_anchor },
        { label: 'How offers are presented', value: dna?.offer_presentation },
      ],
    },
    {
      heading: 'Visual System',
      fields: [
        { label: 'Logo', value: dna?.logo_url },
        { label: 'Primary font', value: dna?.primary_font },
        { label: 'Secondary font', value: dna?.secondary_font },
        { label: 'Headline weight', value: dna?.headline_weight },
        { label: 'Body weight', value: dna?.body_weight },
        { label: 'Primary color', value: dna?.primary_color },
        { label: 'Secondary color', value: dna?.secondary_color },
        { label: 'Accent color', value: dna?.accent_color },
        { label: 'Background colors', value: colorList(dna?.background_colors) },
        { label: 'Contrast color', value: dna?.contrast_color },
        { label: 'CTA style', value: dna?.cta_style },
        { label: 'Photography: lighting', value: dna?.lighting },
        { label: 'Photography: color grading', value: dna?.color_grading },
        { label: 'Photography: composition', value: dna?.composition },
        { label: 'Photography: subject matter', value: dna?.subject_matter },
        { label: 'Photography: props and surfaces', value: dna?.props_and_surfaces },
        { label: 'Mood', value: dna?.mood },
        { label: 'Packaging', value: dna?.packaging_description },
        { label: 'Text overlay style', value: dna?.text_overlay_style },
        { label: 'UGC usage', value: dna?.ugc_usage },
      ],
    },
    {
      heading: 'Brand Guidelines (client-supplied)',
      fields: [
        { label: 'Guidelines', value: context.brandGuidelines },
      ],
    },
    {
      heading: 'Working Links',
      fields: [
        { label: 'Production card', value: prod?.id ? `/brands/${card.brand_id}/projects/${prod.id}` : null },
        { label: 'Landing page URL', value: prod?.lp_url },
        { label: 'Drive folder', value: prod?.drive_folder_url },
      ],
    },
  ], `${brandName ?? ''} · LP brief · ${momentLabel}`.replace(/^ · /, ''))

  if (!context.history?.length) return base

  return `${base}\n## Brand Offer History\n\n${offerHistoryTable(context.history)}\n`
}

export type OffersBoardRow = OfferCard & { brands: { id: string; name: string } }

/** Board-level export: the offer cards on screen as a table, same idea as the pipeline. */
export function offersBoardMarkdown(
  rows: OffersBoardRow[],
  ownerNameFor: (card: OffersBoardRow) => string | null,
  filterNote?: string,
): string {
  const escape = (s: string) => s.replace(/\|/g, '\\|')
  const header = [
    '| Brand | Offer | Month | Stage | Owner |',
    '| --- | --- | --- | --- | --- |',
  ]
  const body = rows.map(c => `| ${[
    escape(c.brands.name),
    escape(c.offer?.trim() || c.name),
    offerMonthLabel(c.target_month),
    OFFER_STAGE_LABELS[c.stage],
    escape(ownerNameFor(c) ?? 'Unassigned'),
  ].join(' | ')} |`)

  const count = `${rows.length} offer${rows.length === 1 ? '' : 's'}`
  const subtitle = filterNote ? `${count} · ${filterNote}` : count
  return `# Offer Cycle\n\n_${subtitle}_\n\n${header.join('\n')}\n${body.join('\n')}\n`
}

function offerHistoryTable(rows: OfferHistoryEntry[]): string {
  const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
  const header = [
    '| Brand | Month | Moment | Offer | Objective | Product | Status | Record |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  const body = rows.map(row => `| ${[
    escape(row.brandName),
    offerMonthLabel(row.targetMonth),
    row.momentSlot ? `M${row.momentSlot}` : '—',
    escape(row.title),
    escape(row.objective ?? '—'),
    escape(row.product ?? '—'),
    escape(row.status),
    row.source === 'offer_cycle' ? 'Offer Cycle' : 'Production history',
  ].join(' | ')} |`)
  return [...header, ...body].join('\n')
}

/** Full historical library, including pre-Offer-Cycle Production records. */
export function offerLibraryMarkdown(rows: OfferHistoryEntry[], filterNote?: string): string {
  const count = `${rows.length} historical offer${rows.length === 1 ? '' : 's'}`
  const subtitle = filterNote ? `${count} · ${filterNote}` : count
  return `# Offer Library\n\n_${subtitle}_\n\n${offerHistoryTable(rows)}\n`
}

// --- Pipeline -----------------------------------------------------------------

export type PipelineRow = Project & { brands: { id: string; name: string } }

/**
 * The pipeline is a list, so it exports as a table rather than as label/value
 * pairs — that is what survives a paste into Slack or a doc. Rows come from
 * what is on screen, so the active search and filters carry into the export.
 */
export function pipelineMarkdown(rows: PipelineRow[], filterNote?: string): string {
  const header = [
    '| Brand | Project | Due | Landing Page | Creatives |',
    '| --- | --- | --- | --- | --- |',
  ]
  const escape = (s: string) => s.replace(/\|/g, '\\|')
  const track = (stage: string, approved: boolean) => {
    const label = STAGE_LABELS[normalizeStage(stage)]
    if (normalizeStage(stage) !== 'client_review') return label
    return approved ? `${label} ✓` : `${label} (pending)`
  }

  const body = rows.map(r => [
    escape(r.brands.name),
    escape(r.name),
    fmtDate(r.due_date) ?? '—',
    track(r.lp_stage, r.lp_approved),
    track(r.creatives_stage, r.creatives_approved),
  ].join(' | '))

  const count = `${rows.length} project${rows.length === 1 ? '' : 's'}`
  const subtitle = filterNote ? `${count} · ${filterNote}` : count

  return `# Active Pipeline\n\n_${subtitle}_\n\n${header.join('\n')}\n${body.map(r => `| ${r} |`).join('\n')}\n`
}
