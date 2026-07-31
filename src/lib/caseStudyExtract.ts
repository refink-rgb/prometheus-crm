import { emptyInputs, type ReportInputs } from '@/data/case-studies/buildReport'

// Prompt + normalisation for the case-study importer. Kept out of the
// 'use server' module so it stays pure and testable (a 'use server' file may
// only export async functions).

export const EXTRACT_SYSTEM_PROMPT = `You restructure a marketing case study into JSON for a report template.

RULES
- Only use facts present in the document. Never invent, estimate or extrapolate a number.
- If a value is not in the document, use an empty string. Do not guess.
- Copy figures exactly as written, including currency symbols and decimals.
- Do NOT include the client's brand name, product names, promo codes or people's
  names anywhere in the output. Refer to them as "the brand", "the moment", "the
  bundle". This report is shown to other clients and must stay anonymous.
- Write in the document's own voice. Do not add marketing adjectives of your own.
- Never use em dashes. Use commas, colons or full stops.

FIELDS
- hero.headline: the document's main claim, one sentence.
- hero.subhead: the supporting sentence under it.
- hero.statValue: the single biggest number, compact (e.g. "$22.7K").
- hero.statCaption: what that number is (e.g. "in attributed revenue, from a single bundle moment").
- industry: the industry line if present.
- statCards: the 3 headline metrics. benchmarkLabel is free text and must match the
  document ("account average", "platform target", "projection"). multiplier like "~1.4x" only if stated or trivially implied.
- snapshotTiles: 3 to 5 secondary figures worth showing at a glance (purchases, CPA, adds to cart, ROAS, ad count).
- narrative: exactly 4 entries with headings "The Challenge", "The Approach", "The Results", "The Insight".
  Each paragraphs array holds ONE string. Condense faithfully; keep the document's argument.
- comparisons: up to 2 side by side comparisons. value is the bare number for the bar height,
  display is the formatted string. note is the explanatory sentence under the chart, if the document has one.
- methodology: the methodology or attribution footnote, if present.`

export interface ExtractedShape {
  industry?: string
  hero?: { headline?: string; subhead?: string; statValue?: string; statCaption?: string }
  statCards?: { label?: string; value?: string; benchmarkValue?: string; benchmarkLabel?: string; multiplier?: string }[]
  snapshotTiles?: { label?: string; value?: string }[]
  narrative?: { heading?: string; paragraphs?: string[] }[]
  comparisons?: {
    label?: string
    campaign?: { label?: string; value?: number; display?: string }
    rest?: { label?: string; value?: number; display?: string }
    multiplier?: string
    note?: string
  }[]
  methodology?: string
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Merge a model response onto a blank set of inputs. Anything missing or
 * malformed keeps a valid shape and simply renders empty for the author to
 * complete, so a partial extraction never produces a broken report.
 */
export function normalizeExtracted(parsed: ExtractedShape): ReportInputs {
  const base = emptyInputs('blank')

  const statCards = (parsed.statCards ?? []).slice(0, 4).map((c) => ({
    label: s(c.label),
    value: s(c.value),
    benchmarkValue: s(c.benchmarkValue),
    benchmarkLabel: s(c.benchmarkLabel) || 'account average',
    multiplier: s(c.multiplier),
    higherIsBetter: true,
  }))

  const tiles = (parsed.snapshotTiles ?? []).slice(0, 6).map((t) => ({ label: s(t.label), value: s(t.value) }))

  // Keep the approved four headings and slot the model's copy into them.
  const narrative = base.narrative.map((section) => {
    const match = (parsed.narrative ?? []).find(
      (x) => s(x.heading).toLowerCase().trim() === section.heading.toLowerCase(),
    )
    return { heading: section.heading, paragraphs: [s(match?.paragraphs?.[0])] }
  })

  const comparisons = (parsed.comparisons ?? []).slice(0, 2).map((c) => ({
    label: s(c.label),
    campaign: { label: s(c.campaign?.label) || 'This moment', value: n(c.campaign?.value), display: s(c.campaign?.display) },
    rest: { label: s(c.rest?.label) || 'Account average', value: n(c.rest?.value), display: s(c.rest?.display) },
    multiplier: s(c.multiplier),
    note: s(c.note),
  }))

  return {
    ...base,
    industry: s(parsed.industry),
    hero: {
      headline: s(parsed.hero?.headline),
      subhead: s(parsed.hero?.subhead),
      statValue: s(parsed.hero?.statValue),
      statCaption: s(parsed.hero?.statCaption),
    },
    statCards: statCards.length ? statCards : base.statCards,
    snapshotTiles: tiles.length ? tiles : base.snapshotTiles,
    narrative,
    comparisons: comparisons.length ? comparisons : base.comparisons,
    methodology: s(parsed.methodology),
  }
}
