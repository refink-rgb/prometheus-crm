import type { CaseStudy } from './types'

// ─── Case study: gift-with-purchase offer test (Meta) ────────────────────────
//
// ANONYMIZED. The featured brand is deliberately unnamed and unidentifiable.
// - Creatives are relabelled "Creative 01"… — original ad names (which contain
//   the brand) are never stored here.
// - Image `src` values are null until REDACTED derivatives exist; the UI renders
//   neutral placeholder tiles in the meantime.
// - Campaign-level figures below are the real supplied numbers. Per-creative
//   rows are PLACEHOLDER fixture data for UI review (`creativesAreFixture`) and
//   must be replaced wholesale by the real Meta Ads Manager export — do not
//   treat them as reportable, and do not invent additional metrics.

const slug = 'c37ad0a3613be6dcaeea9be961dcdf3deec6e6ac'

const caseStudy: CaseStudy = {
  slug,
  internalTitle: 'GWP offer test · Men’s grooming · Meta',
  publishedAt: '2026-07-27',
  creativesAreFixture: true,

  hero: {
    eyebrow: 'PAID MEDIA CASE STUDY · META',
    headline: 'One untested offer became this brand’s best-converting campaign ever',
    subhead:
      'A single gift-with-purchase test on Meta nearly doubled landing-page conversion and drove outsized incremental revenue against the account benchmark.',
    stat: {
      value: '$56.4K',
      caption: 'in incremental revenue, from one offer test',
    },
    meta: [
      { label: 'Industry', value: 'Men’s Grooming & Beard Care' },
      {
        label: 'Services',
        value: 'Paid Media (Meta) · Offer Strategy · Creative · Landing Page',
      },
    ],
  },

  statStrip: [
    {
      label: 'Landing page conversion rate',
      value: '12.57%',
      benchmarkValue: '6.45%',
      benchmarkLabel: 'account average',
      multiplier: '~1.9x',
      higherIsBetter: true,
    },
    {
      label: 'Unique outbound CTR',
      value: '3.18%',
      benchmarkValue: '1.90%',
      benchmarkLabel: 'rest of account',
      multiplier: '~1.7x',
      higherIsBetter: true,
    },
    {
      label: 'Incremental ROAS',
      value: '1.61x',
      benchmarkValue: '1.16x',
      benchmarkLabel: 'account average',
      multiplier: '~1.4x',
      higherIsBetter: true,
    },
  ],

  // Placeholder copy in CTC's voice — final copy to be supplied by the client.
  narrative: [
    {
      heading: 'The Challenge',
      paragraphs: [
        'The account was growing, but growth was expensive. Prospecting sat close to break-even, margins were tight, and every new customer cost more than the last. The team needed a lever that moved unit economics — not just another round of creative.',
      ],
    },
    {
      heading: 'The Approach',
      paragraphs: [
        'Instead of testing more of the same, we tested the offer itself: a gift-with-purchase built to raise perceived value without discounting the core product. We paired it with a purpose-built landing page and a fresh creative slate, then isolated the test so its impact could be measured against the rest of the account.',
      ],
    },
    {
      heading: 'The Results',
      paragraphs: [
        'The offer converted. Landing-page conversion rate nearly doubled the account average, unique outbound CTR ran well ahead of the rest of the account, and the test returned an incremental ROAS of 1.61x — driving $56.4K in incremental revenue from a single moment.',
      ],
    },
    {
      heading: 'The Insight',
      paragraphs: [
        'The winning variable wasn’t spend or audience — it was the offer. Testing the offer as its own lever, with the landing page and creative built to sell it, turned an untested idea into the account’s best-converting campaign. That’s a repeatable play, not a one-off.',
      ],
    },
  ],

  landing: {
    image: {
      // Redacted landing-page screenshot goes here once treated. null → placeholder.
      src: null,
      alt: 'Redacted landing page for the offer test',
      width: 1200,
      height: 3000,
    },
    device: 'desktop',
    hotspots: [
      {
        id: 'price-anchor',
        number: 1,
        xPct: 34,
        yPct: 21,
        title: 'Strikethrough price anchor',
        body: 'The original price is shown struck through beside the offer price, anchoring perceived value so the deal reads as a saving, not a discount on the core product.',
      },
      {
        id: 'free-shipping',
        number: 2,
        xPct: 68,
        yPct: 30,
        title: 'Free-shipping call-out',
        body: 'A persistent free-shipping badge removes the single most common checkout objection before the visitor ever reaches the cart.',
      },
      {
        id: 'gwp-box',
        number: 3,
        xPct: 50,
        yPct: 48,
        title: 'Gift-with-purchase box',
        body: 'The free gift is presented as its own visual block with its own value, raising the perceived worth of the bundle without touching the headline product’s price.',
      },
      {
        id: 'trust-badge',
        number: 4,
        xPct: 24,
        yPct: 63,
        title: 'Social-proof / trust badge',
        body: 'Review counts and trust signals sit directly next to the call to action, borrowing credibility exactly where hesitation peaks.',
      },
      {
        id: 'offer-selector',
        number: 5,
        xPct: 60,
        yPct: 78,
        title: 'Offer selector',
        body: 'A clear tiered selector lets the visitor self-select into the higher-value bundle, nudging average order value up at the point of decision.',
      },
    ],
  },

  // PLACEHOLDER fixture creatives for UI review only — replace with the real
  // Meta export. Posters are null → neutral placeholder tiles (no raw brand art).
  creatives: [
    {
      id: 'c01',
      label: 'Creative 01',
      media: { kind: 'video', poster: { src: null, alt: 'Creative 01 preview' }, video: null },
      metrics: { impressions: 412300, cpm: 18.42, uniqueOutboundCtr: 4.21, cpc: 0.71, purchases: 78, revenue: 9820.44, roas: 3.94, costPerPurchase: 19.6 },
      isTopPerformer: true,
    },
    {
      id: 'c02',
      label: 'Creative 02',
      media: { kind: 'video', poster: { src: null, alt: 'Creative 02 preview' }, video: null },
      metrics: { impressions: 388100, cpm: 19.1, uniqueOutboundCtr: 3.76, cpc: 0.79, purchases: 64, revenue: 7541.2, roas: 3.42, costPerPurchase: 21.1 },
      isTopPerformer: true,
    },
    {
      id: 'c03',
      label: 'Creative 03',
      media: { kind: 'image', poster: { src: null, alt: 'Creative 03 preview' } },
      metrics: { impressions: 301500, cpm: 17.8, uniqueOutboundCtr: 3.33, cpc: 0.82, purchases: 52, revenue: 6120.9, roas: 3.11, costPerPurchase: 22.4 },
    },
    {
      id: 'c04',
      label: 'Creative 04',
      media: { kind: 'video', poster: { src: null, alt: 'Creative 04 preview' }, video: null },
      metrics: { impressions: 276400, cpm: 20.3, uniqueOutboundCtr: 3.05, cpc: 0.9, purchases: 41, revenue: 4880.0, roas: 2.74, costPerPurchase: 24.9 },
    },
    {
      id: 'c05',
      label: 'Creative 05',
      media: { kind: 'image', poster: { src: null, alt: 'Creative 05 preview' } },
      metrics: { impressions: 219800, cpm: 16.9, uniqueOutboundCtr: 2.88, cpc: 0.85, purchases: 33, revenue: 3702.5, roas: 2.55, costPerPurchase: 26.1 },
    },
    {
      id: 'c06',
      label: 'Creative 06',
      media: { kind: 'video', poster: { src: null, alt: 'Creative 06 preview' }, video: null },
      metrics: { impressions: 184200, cpm: 21.2, uniqueOutboundCtr: 2.51, cpc: 0.98, purchases: 24, revenue: 2610.75, roas: 2.18, costPerPurchase: 28.7 },
    },
    {
      id: 'c07',
      label: 'Creative 07',
      media: { kind: 'image', poster: { src: null, alt: 'Creative 07 preview' } },
      metrics: { impressions: 142600, cpm: 18.05, uniqueOutboundCtr: 2.19, cpc: 1.02, purchases: 17, revenue: 1840.3, roas: 1.92, costPerPurchase: 31.2 },
    },
    {
      id: 'c08',
      label: 'Creative 08',
      media: { kind: 'image', poster: { src: null, alt: 'Creative 08 preview' } },
      // Example of a partial row: some values missing → explicit empty states.
      metrics: { impressions: 98400, cpm: 19.6, uniqueOutboundCtr: 1.87, cpc: null, purchases: 9, revenue: 903.1, roas: 1.44, costPerPurchase: null },
    },
  ],

  creativeBenchmark: {
    uniqueOutboundCtr: 1.9,
    roas: 1.16,
  },

  comparisons: [
    {
      label: 'Creative performance — unique outbound CTR',
      campaign: { label: 'This campaign', value: 3.18, display: '3.18%' },
      rest: { label: 'Rest of account', value: 1.9, display: '1.90%' },
      multiplier: '~1.7x',
    },
    {
      label: 'Revenue efficiency — average revenue per ad',
      campaign: { label: 'This campaign (24 ads)', value: 2351, display: '$2,351' },
      rest: { label: 'Rest of account (68 ads)', value: 470, display: '$470' },
      multiplier: '~5x',
    },
  ],

  closing: {
    headline: 'Want this for your brand?',
    body: 'One offer test moved the whole account. Let’s find the moment that does the same for you.',
    buttonLabel: 'Start a marketing moment',
    href: null, // destination to be supplied
  },

  campaign: {
    revenue: 56427.61,
    purchases: 404,
    costPerPurchase: 21.74,
    blendedRoas: 3.08,
    incrementalRoas: 1.61,
    incrementalRoasBenchmark: 1.16,
    lpConversionRate: 12.57,
    lpConversionBenchmark: 6.45,
    uniqueOutboundCtr: 3.18,
    uniqueOutboundCtrBenchmark: 1.9,
    adsInTest: 24,
    restOfAccountAds: 68,
    restOfAccountRevenue: 31971.63,
  },
}

export default caseStudy
