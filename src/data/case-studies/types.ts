// ─── Case-study showcase data model ──────────────────────────────────────────
//
// One typed shape drives every showcase page. Adding a new case study = add one
// data file that satisfies `CaseStudy` + one entry in `index.ts`. No component
// changes. See `src/app/(public)/showcase/[slug]/page.tsx`.
//
// ANONYMIZATION CONTRACT (hard requirement — treat any leak as a launch blocker):
// nothing in a CaseStudy object may identify the featured brand. That means no
// brand name in any string here — not in `internalTitle`, labels, alt text,
// creative labels (use "Creative 01"…), image paths, or copy. Original ad names
// (which contain the brand) must be relabelled at THIS layer and never stored.
// A `null` metric renders an explicit empty state — never invent/estimate a value.

/** A single metric shown against an account benchmark (stat strip). */
export interface StatComparison {
  /** e.g. "Landing page conversion rate" */
  label: string
  /** Formatted test value, e.g. "12.57%" */
  value: string
  /** Formatted benchmark value, e.g. "6.45%" */
  benchmarkValue: string
  /** e.g. "account average", "rest of account" */
  benchmarkLabel: string
  /** Optional headline multiple, e.g. "~1.9x better" */
  multiplier?: string
  /** Higher value = better result (drives the up/down affordance). Default true. */
  higherIsBetter?: boolean
}

/** The one oversized hero stat — the largest element on the page. */
export interface HeroStat {
  /** e.g. "$56.4K" */
  value: string
  /** e.g. "in incremental revenue, from one offer test" */
  caption: string
}

export interface MetaItem {
  label: string
  value: string
}

export interface Hero {
  eyebrow: string
  headline: string
  subhead: string
  stat: HeroStat
  meta: MetaItem[]
}

export interface NarrativeSection {
  heading: string
  paragraphs: string[]
}

/**
 * A numbered annotation hotspot over the landing-page screenshot. Position is
 * expressed as a percentage of the image box so it survives responsive resizing
 * and can be re-authored per case study.
 */
export interface Hotspot {
  id: string
  /** Display number shown in the marker. */
  number: number
  /** 0–100, left edge → right edge of the image. */
  xPct: number
  /** 0–100, top edge → bottom edge of the image. */
  yPct: number
  title: string
  body: string
}

/** A redacted image reference. `src` may be null until a treated asset exists. */
export interface ShowcaseImage {
  /** Path/URL to a REDACTED derivative only. null → render an empty placeholder. */
  src: string | null
  /** Neutral alt text — never the brand or product/scent names. */
  alt: string
  width?: number
  height?: number
}

export interface LandingShowcase {
  /** Redacted landing-page screenshot. */
  image: ShowcaseImage
  /** Frame the image reads inside so it feels like a real page. */
  device: 'desktop' | 'mobile'
  hotspots: Hotspot[]
}

export type CreativeMediaKind = 'image' | 'video'

export interface CreativeMedia {
  kind: CreativeMediaKind
  /** Redacted poster/thumbnail derivative. null → placeholder tile. */
  poster: ShowcaseImage
  /** Redacted video derivative (only for kind === 'video'). null → poster only. */
  video?: string | null
}

/**
 * Per-creative metrics from the Meta Ads Manager export. Every field is nullable:
 * a missing value renders an explicit empty state and is NEVER invented.
 */
export interface CreativeMetrics {
  impressions: number | null
  /** Cost per 1,000 impressions, USD. */
  cpm: number | null
  /** Unique outbound CTR, percent (e.g. 3.18 = 3.18%). */
  uniqueOutboundCtr: number | null
  /** Cost per click, USD. */
  cpc: number | null
  purchases: number | null
  revenue: number | null
  roas: number | null
  costPerPurchase: number | null
}

export interface Creative {
  id: string
  /** Neutral identifier only, e.g. "Creative 01". Never the original ad name. */
  label: string
  media: CreativeMedia
  metrics: CreativeMetrics
  /** Visually flagged as a top performer. */
  isTopPerformer?: boolean
}

/** Account benchmark the creatives are measured against. */
export interface CreativeBenchmark {
  uniqueOutboundCtr: number | null
  roas: number | null
}

/** The metric keys a reader can sort the creative gallery by. */
export type CreativeSortKey = 'revenue' | 'roas' | 'uniqueOutboundCtr' | 'spend'

/** A single side-by-side comparison rendered as two columns. */
export interface ComparisonBar {
  label: string
  /** The campaign / moment being featured. */
  campaign: { label: string; value: number; display: string }
  /** What it is measured against (account, target, projection…). */
  rest: { label: string; value: number; display: string }
  /** Headline multiple, e.g. "~1.7x". */
  multiplier: string
  /**
   * Optional explainer under the columns. Carries the "so what" a bare chart
   * can't (e.g. why attributed revenue outran revenue converted on the code).
   */
  note?: string | null
}

/**
 * One tile in the "at a glance" band. Free-form label + preformatted value so
 * each case study can lead with whatever metrics its story turns on (revenue
 * and ROAS for a conversion story, CPA and adds-to-cart for an order-value one).
 */
export interface SnapshotTile {
  label: string
  /** Already formatted for display, e.g. "$56,427.61", "404", "5.15x". */
  value: string
}

export interface ClosingCta {
  headline: string
  /** The guarantee promise, stated in one line. */
  body: string
  /**
   * Plain-English restatement of the guarantee, so a reader understands exactly
   * what is being promised (and what happens if we miss). Optional for older
   * stored reports — the component falls back to a default.
   */
  note?: string | null
  buttonLabel: string
  /** Destination URL. null → button is a non-clickable CTA label (e.g. "Message me"). */
  href: string | null
}

/** Optional credibility screenshot (ad-account export) shown between the stats. */
export interface ProofImage {
  /** Uploaded (public) image URL. */
  src: string
  caption: string
}

/** One reason the result holds up as incremental. */
export interface IncrementalityPoint {
  title: string
  body: string
}

/**
 * The "Is this incremental?" section — our commercial explanation of why the
 * result is additive rather than reshuffled demand. Same for every report
 * (it's the methodology, not per-campaign data).
 */
export interface Incrementality {
  question: string
  answer: string
  points: IncrementalityPoint[]
}

/** Campaign-level figures (these are the real, supplied numbers). */
export interface CampaignFigures {
  revenue: number
  purchases: number
  costPerPurchase: number
  blendedRoas: number
  incrementalRoas: number
  incrementalRoasBenchmark: number
  lpConversionRate: number
  lpConversionBenchmark: number
  uniqueOutboundCtr: number
  uniqueOutboundCtrBenchmark: number
  adsInTest: number
  restOfAccountAds: number
  restOfAccountRevenue: number
}

export interface CaseStudy {
  /** Unguessable hex slug = the route. Never derived from the brand. */
  slug: string
  /**
   * Internal-only label for the CRM showcase list. Still MUST NOT contain the
   * brand name — it is only an internal handle for the person copying the link.
   */
  internalTitle: string
  /** ISO date; internal display only. */
  publishedAt?: string
  /**
   * True while the per-creative rows are placeholder fixture data for UI review
   * (campaign-level figures are always real). Flip to false / remove once the
   * real Meta export lands. Lets the UI surface a "sample data" affordance.
   */
  creativesAreFixture?: boolean

  hero: Hero
  statStrip: StatComparison[]
  narrative: NarrativeSection[]
  landing: LandingShowcase
  creatives: Creative[]
  creativeBenchmark: CreativeBenchmark
  comparisons: ComparisonBar[]
  /** Why the result is incremental. Optional — the component falls back to the default. */
  incrementality?: Incrementality | null
  closing: ClosingCta
  /**
   * "At a glance" tiles. Optional: reports generated before this field existed
   * fall back to deriving tiles from `campaign`.
   */
  snapshotTiles?: SnapshotTile[] | null
  /**
   * Footnote stating where the figures come from (platform-attributed vs
   * blended business reporting, comparison window, how spend was derived).
   * Optional, but it is what makes the numbers credible to a sceptical reader.
   */
  methodology?: string | null
  /**
   * Raw campaign figures. Optional now that snapshot tiles and stat cards are
   * authored directly — kept for older reports and the derived-tiles fallback.
   */
  campaign?: CampaignFigures
  /** Trailing "+N more" count for the creative carousel (e.g. 40). null → derived. */
  moreAdsCount?: number | null
  /** Optional ad-account screenshot shown between the stat cards and the snapshot. */
  proof?: ProofImage | null
}
