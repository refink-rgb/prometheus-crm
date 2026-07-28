import type { CampaignFigures, CaseStudy, Creative } from './types'

// ─── Simplified report inputs → full CaseStudy ───────────────────────────────
//
// The Marketing form collects only three things: the campaign figures block, the
// LP image, and a few creative examples (with optional illustrative metrics).
// Everything else on the report is DERIVED from the campaign block (the 3 stat
// cards, the comparison bars, the hero number) or TEMPLATED (hero/narrative/
// closing copy). This keeps the form tiny and the report consistent.

export interface CreativeInput {
  /** Uploaded (public) image URL, or null. */
  posterUrl: string | null
  /** Illustrative — may be blank. Null renders an explicit "—". */
  revenue: number | null
  roas: number | null
  uniqueOutboundCtr: number | null
}

export interface ReportInputs {
  campaign: CampaignFigures
  /** Hero "Industry" label. */
  industry: string
  /** Uploaded LP screenshot image URL (rendered as the landing page). */
  lpImageUrl: string | null
  creatives: CreativeInput[]
  /** Trailing "+N more" count for the creative carousel (e.g. 40). null → derived. */
  moreAdsCount: number | null
  /** Closing CTA destination (optional — blank renders a plain "Message Joy" CTA). */
  closingHref: string | null
}

// ─── formatters (self-contained; no cross-layer import) ──────────────────────

function compactUsd(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}
function usd0(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}
function pct(n: number): string {
  return `${n}%`
}
function roas(n: number): string {
  return `${n}x`
}
function mult(a: number, b: number): string {
  if (!b) return ''
  return `~${(a / b).toFixed(1)}x`
}
function multRound(a: number, b: number): string {
  if (!b) return ''
  return `~${Math.round(a / b)}x`
}

const SERVICES = 'Paid Media (Meta) · Offer Strategy · Creative · Landing Page'

export const DEFAULT_INDUSTRY = 'Men’s Grooming & Beard Care'

export function emptyCampaign(): CampaignFigures {
  return {
    revenue: 0, purchases: 0, costPerPurchase: 0, blendedRoas: 0,
    incrementalRoas: 0, incrementalRoasBenchmark: 0,
    lpConversionRate: 0, lpConversionBenchmark: 0,
    uniqueOutboundCtr: 0, uniqueOutboundCtrBenchmark: 0,
    adsInTest: 0, restOfAccountAds: 0, restOfAccountRevenue: 0,
  }
}

// Build a complete, render-ready CaseStudy from the simplified inputs. `slug` is
// filled in by the server action (the report token).
export function buildReportCaseStudy(input: ReportInputs, slug = ''): CaseStudy {
  const c = input.campaign

  // Flag the highest-revenue creative (only if any revenue was entered).
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

  const revPerAdCampaign = c.adsInTest ? c.revenue / c.adsInTest : 0
  const revPerAdRest = c.restOfAccountAds ? c.restOfAccountRevenue / c.restOfAccountAds : 0

  return {
    slug,
    internalTitle: 'Marketing moment report',
    publishedAt: new Date().toISOString().slice(0, 10),
    creativesAreFixture: false,

    hero: {
      eyebrow: 'PAID MEDIA CASE STUDY · META',
      headline: 'One untested offer became this brand’s best-converting campaign ever',
      subhead:
        'A single offer test on Meta nearly doubled landing-page conversion and drove outsized incremental revenue against the account benchmark.',
      stat: { value: compactUsd(c.revenue), caption: 'in revenue, from one offer test' },
      meta: [
        { label: 'Industry', value: input.industry || DEFAULT_INDUSTRY },
        { label: 'Services', value: SERVICES },
      ],
    },

    // Derived straight from the campaign block.
    statStrip: [
      { label: 'Landing page conversion rate', value: pct(c.lpConversionRate), benchmarkValue: pct(c.lpConversionBenchmark), benchmarkLabel: 'account average', multiplier: mult(c.lpConversionRate, c.lpConversionBenchmark) },
      { label: 'Unique outbound CTR', value: pct(c.uniqueOutboundCtr), benchmarkValue: pct(c.uniqueOutboundCtrBenchmark), benchmarkLabel: 'rest of account', multiplier: mult(c.uniqueOutboundCtr, c.uniqueOutboundCtrBenchmark) },
      { label: 'Incremental ROAS', value: roas(c.incrementalRoas), benchmarkValue: roas(c.incrementalRoasBenchmark), benchmarkLabel: 'account average', multiplier: mult(c.incrementalRoas, c.incrementalRoasBenchmark) },
    ],

    // Templated copy.
    narrative: [
      { heading: 'The Challenge', paragraphs: ['The account was growing, but growth was expensive. Prospecting sat close to break-even and every new customer cost more than the last. The team needed a lever that moved unit economics — not just another round of creative.'] },
      { heading: 'The Approach', paragraphs: ['Instead of testing more of the same, we tested the offer itself — built to raise perceived value without discounting the core product — paired with a purpose-built landing page and a fresh creative slate, isolated so its impact could be measured against the rest of the account.'] },
      { heading: 'The Results', paragraphs: ['The offer converted. Landing-page conversion nearly doubled the account average, unique outbound CTR ran well ahead of the rest of the account, and the test returned an incremental ROAS above the benchmark — driving meaningful incremental revenue from a single moment.'] },
      { heading: 'The Insight', paragraphs: ['The winning variable wasn’t spend or audience — it was the offer. Testing the offer as its own lever, with the landing page and creative built to sell it, turned an untested idea into the account’s best-converting campaign. That’s a repeatable play, not a one-off.'] },
    ],

    landing: {
      image: { src: input.lpImageUrl, alt: 'The landing page built for the offer test', width: 1200, height: 3000 },
      device: 'desktop',
      hotspots: [], // no annotation hotspots in the simplified report — image only
    },

    creatives,
    creativeBenchmark: { uniqueOutboundCtr: c.uniqueOutboundCtrBenchmark || null, roas: c.incrementalRoasBenchmark || null },

    // Derived comparison bars.
    comparisons: [
      {
        label: 'Creative performance — unique outbound CTR',
        campaign: { label: 'This campaign', value: c.uniqueOutboundCtr, display: pct(c.uniqueOutboundCtr) },
        rest: { label: 'Rest of account', value: c.uniqueOutboundCtrBenchmark, display: pct(c.uniqueOutboundCtrBenchmark) },
        multiplier: mult(c.uniqueOutboundCtr, c.uniqueOutboundCtrBenchmark),
      },
      {
        label: 'Revenue efficiency — average revenue per ad',
        campaign: { label: `This campaign (${c.adsInTest} ads)`, value: revPerAdCampaign, display: usd0(revPerAdCampaign) },
        rest: { label: `Rest of account (${c.restOfAccountAds} ads)`, value: revPerAdRest, display: usd0(revPerAdRest) },
        multiplier: multRound(revPerAdCampaign, revPerAdRest),
      },
    ],

    closing: {
      headline: 'Want this for your brand?',
      body: 'Guaranteed revenue in excess of cost — or you don’t pay.',
      buttonLabel: 'Message Me',
      // Defaults to the Slack DM; a per-report closingHref overrides it.
      href: input.closingHref || 'https://commonthreadco.slack.com/archives/D0B9QMM09ED',
    },

    campaign: c,
    moreAdsCount: input.moreAdsCount,
  }
}

// Reverse-map a stored report back to the simplified inputs (for the edit form).
export function caseStudyToInputs(cs: CaseStudy): ReportInputs {
  return {
    campaign: cs.campaign,
    industry: cs.hero.meta.find((m) => /industry/i.test(m.label))?.value ?? DEFAULT_INDUSTRY,
    lpImageUrl: cs.landing.image.src,
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
