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
  type OfferCard, type Project,
} from './types'

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

export function offerCardMarkdown(card: OfferCard, ownerName?: string | null): string {
  return buildMarkdown(card.name, [
    {
      fields: [
        { label: 'Brand', value: card.brand?.name ?? null },
        { label: 'Target Month', value: offerMonthLabel(card.target_month) },
        { label: 'Moment', value: `M${card.moment_slot}` },
        { label: 'Stage', value: OFFER_STAGE_LABELS[card.stage] },
        { label: 'Owner', value: ownerName },
      ],
    },
    {
      heading: 'The Offer',
      fields: [
        { label: 'Offer Dynamics', value: card.offer_dynamics_type },
        { label: 'Offer', value: card.offer },
        { label: 'Offer Description', value: card.offer_description },
      ],
    },
    {
      heading: 'Rationale',
      fields: [
        { label: 'Problem Statement', value: card.problem_statement },
        { label: 'Success Metric', value: card.success_metric },
        { label: 'Success Target', value: card.success_target },
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
      heading: 'Creative',
      fields: [
        { label: 'Competitor Reference', value: card.competitor_reference },
        { label: 'Client Ad Inspiration', value: card.client_ad_inspiration },
        { label: 'Product Images', value: card.product_images_link },
      ],
    },
    {
      heading: 'Client Approval Message',
      fields: [
        { label: 'Message', value: card.client_approval_message },
      ],
    },
  ], card.brand?.name ?? undefined)
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
