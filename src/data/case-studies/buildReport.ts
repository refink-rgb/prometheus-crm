import type {
  CaseStudy,
  ComparisonBar,
  Creative,
  Incrementality,
  NarrativeSection,
  SnapshotTile,
  StatComparison,
} from './types'

// ─── Report inputs → full CaseStudy ──────────────────────────────────────────
//
// The page STRUCTURE is fixed and approved (hero → stats → proof → snapshot →
// narrative → LP → creatives → comparison → incrementality → CTA). What varies
// per case study is the FOCUS: which metrics lead, what they're benchmarked
// against, and how the story is framed.
//
// So every slot below is authored per report rather than derived from a fixed
// set of numbers. `FOCUS_PRESETS` pre-fills the slots for the common angles so
// a new report is "pick a focus, fill the values" instead of typing structure.

// The commercial answer to the first question a sharp reader asks: "sure, but
// did you ADD revenue, or just move it around?" This is our methodology, so it
// is identical on every report. Exported so the component can fall back to it
// for reports stored before the section existed.
export const DEFAULT_INCREMENTALITY: Incrementality = {
  question: 'Is this incremental?',
  answer: 'Yes. This revenue is additive, not reshuffled.',
  points: [
    {
      title: 'We run the offer unlisted',
      body: 'The offer lives on an announcement bar, not the homepage and not the hero. Customers who were already on their way to buy never get diverted into it. The demand is created by the media we run against it, not borrowed from sales the brand was going to make anyway.',
    },
    {
      title: 'We never split existing traffic',
      body: 'Every test launches as a new campaign on additive spend. The campaigns already running stay untouched and keep serving. Nothing gets cannibalised, so the result lands on top of the account instead of being carved out of it.',
    },
    {
      title: 'It runs side by side with the account',
      body: 'The moment runs alongside everything else over the same window, under the same conditions. That is why every number here is measured against the account’s own benchmark rather than an industry average: same account, same period, like for like.',
    },
    {
      title: 'We know the numbers before we build',
      body: 'We hold market data across the categories we operate in, so we know the AOV, CAC and margin an offer has to clear before a dollar goes live. The offer is engineered to hit those numbers, which is why the downside on a moment test stays close to break-even even when it loses.',
    },
  ],
}

export interface CreativeInput {
  /** Uploaded (public) image URL, or null. */
  posterUrl: string | null
  /** Illustrative only; may be blank. */
  revenue: number | null
  roas: number | null
  uniqueOutboundCtr: number | null
}

export interface HeroInput {
  headline: string
  subhead: string
  /** The oversized number, preformatted (e.g. "$56.4K"). */
  statValue: string
  statCaption: string
}

export interface ReportInputs {
  /** Which preset the slots were seeded from. Stored for the edit form. */
  focus: FocusKey
  industry: string
  hero: HeroInput
  statCards: StatComparison[]
  snapshotTiles: SnapshotTile[]
  narrative: NarrativeSection[]
  comparisons: ComparisonBar[]
  /** Where the figures come from. Rendered as a footnote. */
  methodology: string | null
  /** The written Slack announcement. The report URL is appended at send time. */
  slackPost: string | null
  lpImageUrl: string | null
  proofImageUrl: string | null
  creatives: CreativeInput[]
  /** Trailing "+N more" count for the creative carousel. */
  moreAdsCount: number | null
  /** Closing CTA destination. Blank falls back to the Slack DM. */
  closingHref: string | null
}

// ─── Focus presets ───────────────────────────────────────────────────────────

export type FocusKey = 'conversion' | 'order-value' | 'efficiency' | 'blank'

export const FOCUS_OPTIONS: { key: FocusKey; label: string; hint: string }[] = [
  { key: 'conversion', label: 'Conversion', hint: 'The offer converted better than the account. Leads with LP conversion, CTR and incremental ROAS.' },
  { key: 'order-value', label: 'Order value', hint: 'The moment raised order size. Leads with AOV, CTR and contribution margin.' },
  { key: 'efficiency', label: 'Efficiency', hint: 'The moment bought results cheaper. Leads with cost per purchase, ROAS and CTR.' },
  { key: 'blank', label: 'Blank', hint: 'Empty rows. Author every slot yourself.' },
]

const stat = (label: string, benchmarkLabel: string): StatComparison => ({
  label,
  value: '',
  benchmarkValue: '',
  benchmarkLabel,
  multiplier: '',
  higherIsBetter: true,
})
const tile = (label: string): SnapshotTile => ({ label, value: '' })
const bar = (label: string, campaignLabel: string, restLabel: string): ComparisonBar => ({
  label,
  campaign: { label: campaignLabel, value: 0, display: '' },
  rest: { label: restLabel, value: 0, display: '' },
  multiplier: '',
  note: '',
})

// The four narrative beats are part of the approved structure, so the headings
// are constant; only the copy changes per case study.
export const NARRATIVE_HEADINGS = ['The Challenge', 'The Approach', 'The Results', 'The Insight']

const emptyNarrative = (): NarrativeSection[] =>
  NARRATIVE_HEADINGS.map((heading) => ({ heading, paragraphs: [''] }))

export interface PresetSlots {
  statCards: StatComparison[]
  snapshotTiles: SnapshotTile[]
  comparisons: ComparisonBar[]
}

export function presetSlots(focus: FocusKey): PresetSlots {
  switch (focus) {
    case 'conversion':
      return {
        statCards: [
          stat('Landing page conversion rate', 'account average'),
          stat('Unique outbound CTR', 'rest of account'),
          stat('Incremental ROAS', 'account average'),
        ],
        snapshotTiles: [tile('Revenue'), tile('Purchases'), tile('Cost per purchase'), tile('Blended ROAS'), tile('Ads in test')],
        comparisons: [
          bar('Creative performance: unique outbound CTR', 'This campaign', 'Rest of account'),
          bar('Revenue efficiency: average revenue per ad', 'This campaign', 'Rest of account'),
        ],
      }
    case 'order-value':
      return {
        statCards: [
          stat('Average order value', 'account average'),
          stat('Unique CTR', 'platform target'),
          stat('Monthly contribution margin', 'projection'),
        ],
        snapshotTiles: [tile('Purchases'), tile('Cost per purchase'), tile('Adds to cart'), tile('New-acquisition ROAS'), tile('Ads in test')],
        comparisons: [
          bar('Average order value: the moment vs the account', 'This moment', 'Account average'),
          bar('Attributed revenue vs revenue converted on the offer', 'Attributed to the moment', 'Converted on the code'),
        ],
      }
    case 'efficiency':
      return {
        statCards: [
          stat('Cost per purchase', 'account average'),
          stat('ROAS', 'account average'),
          stat('Unique outbound CTR', 'rest of account'),
        ],
        snapshotTiles: [tile('Revenue'), tile('Purchases'), tile('Spend'), tile('ROAS'), tile('Ads in test')],
        comparisons: [
          bar('Cost per purchase: the moment vs the account', 'This moment', 'Account average'),
          bar('Return on ad spend: the moment vs the account', 'This moment', 'Account average'),
        ],
      }
    case 'blank':
    default:
      return {
        statCards: [stat('', 'account average')],
        snapshotTiles: [tile('')],
        comparisons: [bar('', 'This moment', 'Account average')],
      }
  }
}

const SERVICES = 'Paid Media (Meta) · Offer Strategy · Creative · Landing Page'
export const DEFAULT_INDUSTRY = 'Men’s Grooming & Beard Care'

/** A blank report seeded from a focus preset. */
export function emptyInputs(focus: FocusKey = 'conversion'): ReportInputs {
  const slots = presetSlots(focus)
  return {
    focus,
    industry: '',
    hero: { headline: '', subhead: '', statValue: '', statCaption: '' },
    ...slots,
    narrative: emptyNarrative(),
    methodology: '',
    slackPost: '',
    lpImageUrl: null,
    proofImageUrl: null,
    creatives: [{ posterUrl: null, revenue: null, roas: null, uniqueOutboundCtr: null }],
    moreAdsCount: null,
    closingHref: null,
  }
}

// ─── Build ───────────────────────────────────────────────────────────────────

// Assemble a render-ready CaseStudy from the authored slots. `slug` is supplied
// by the server action (the report token). Nothing is invented here: empty
// values stay empty and render as explicit blanks.
export function buildReportCaseStudy(input: ReportInputs, slug = ''): CaseStudy {
  // Creative labels are forced neutral here so original ad names (which carry
  // the brand) can never reach the payload.
  const maxRev = Math.max(0, ...input.creatives.map((x) => x.revenue ?? 0))
  const creatives: Creative[] = input.creatives.map((x, i) => ({
    id: `c${i + 1}`,
    label: `Creative ${String(i + 1).padStart(2, '0')}`,
    media: {
      kind: 'image',
      poster: { src: x.posterUrl, alt: `Creative ${String(i + 1).padStart(2, '0')} example` },
    },
    metrics: {
      impressions: null,
      cpm: null,
      uniqueOutboundCtr: x.uniqueOutboundCtr,
      cpc: null,
      purchases: null,
      revenue: x.revenue,
      roas: x.roas,
      costPerPurchase: null,
    },
    isTopPerformer: maxRev > 0 && x.revenue === maxRev,
  }))

  return {
    slug,
    internalTitle: 'Marketing moment report',
    publishedAt: new Date().toISOString().slice(0, 10),
    creativesAreFixture: false,

    hero: {
      eyebrow: 'PAID MEDIA CASE STUDY · META',
      headline: input.hero.headline,
      subhead: input.hero.subhead,
      stat: { value: input.hero.statValue, caption: input.hero.statCaption },
      meta: [
        { label: 'Industry', value: input.industry || DEFAULT_INDUSTRY },
        { label: 'Services', value: SERVICES },
      ],
    },

    statStrip: input.statCards,
    snapshotTiles: input.snapshotTiles,
    narrative: input.narrative,

    landing: {
      image: { src: input.lpImageUrl, alt: 'The landing page built for this moment', width: 1200, height: 3000 },
      device: 'desktop',
      hotspots: [],
    },

    creatives,
    creativeBenchmark: { uniqueOutboundCtr: null, roas: null },
    comparisons: input.comparisons,
    incrementality: DEFAULT_INCREMENTALITY,
    methodology: input.methodology || null,
    slackPost: input.slackPost || null,

    closing: {
      headline: 'Want this for your brand?',
      body: 'Guaranteed revenue in excess of cost, or you don’t pay.',
      note: 'Every dollar you put into a marketing moment comes back in revenue. If it doesn’t, you don’t pay for the work. That’s the deal.',
      buttonLabel: 'Message Me',
      href: input.closingHref || 'https://commonthreadco.slack.com/archives/D0B9QMM09ED',
    },

    moreAdsCount: input.moreAdsCount,
    proof: input.proofImageUrl
      ? { src: input.proofImageUrl, caption: 'Straight from the ad account. These are the real numbers.' }
      : null,
  }
}

// Derive snapshot tiles from the legacy campaign block, so reports generated
// before `snapshotTiles` existed still render an "at a glance" band.
export function tilesFromCampaign(c: NonNullable<CaseStudy['campaign']>): SnapshotTile[] {
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const int = (n: number) => n.toLocaleString('en-US')
  return [
    { label: 'Revenue', value: usd(c.revenue) },
    { label: 'Purchases', value: int(c.purchases) },
    { label: 'Cost per purchase', value: usd(c.costPerPurchase) },
    { label: 'Blended ROAS', value: `${c.blendedRoas}x` },
    { label: 'Ads in test', value: int(c.adsInTest) },
  ]
}

// Reverse-map a stored report back into editable inputs for the edit form.
export function caseStudyToInputs(cs: CaseStudy): ReportInputs {
  return {
    focus: 'blank', // stored reports are already authored; don't re-seed slots
    industry: cs.hero.meta.find((m) => /industry/i.test(m.label))?.value ?? '',
    hero: {
      headline: cs.hero.headline,
      subhead: cs.hero.subhead,
      statValue: cs.hero.stat.value,
      statCaption: cs.hero.stat.caption,
    },
    statCards: cs.statStrip,
    snapshotTiles: cs.snapshotTiles ?? (cs.campaign ? tilesFromCampaign(cs.campaign) : []),
    narrative: cs.narrative,
    comparisons: cs.comparisons.map((c) => ({ ...c, note: c.note ?? '' })),
    methodology: cs.methodology ?? '',
    slackPost: cs.slackPost ?? '',
    lpImageUrl: cs.landing.image.src,
    proofImageUrl: cs.proof?.src ?? null,
    creatives: cs.creatives.map((c) => ({
      posterUrl: c.media.poster.src,
      revenue: c.metrics.revenue,
      roas: c.metrics.roas,
      uniqueOutboundCtr: c.metrics.uniqueOutboundCtr,
    })),
    moreAdsCount: cs.moreAdsCount ?? null,
    closingHref: cs.closing.href,
  }
}
