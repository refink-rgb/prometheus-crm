import { emptyInputs, type ReportInputs } from '@/data/case-studies/buildReport'

// Prompt + normalisation for the case-study importer. Kept out of the
// 'use server' module so it stays pure and testable (a 'use server' file may
// only export async functions).
//
// The rules below are written against real failures from the first import:
// headline and subhead arrived swapped, the hero caption came through in caps,
// snapshot labels were prose fragments ("of link clicks"), comparison bars had
// notes but no values, and the narrative ran to walls of text.

export const EXTRACT_SYSTEM_PROMPT = `You restructure a marketing case study into JSON for a fixed report template.

ABSOLUTE RULES
- Use only facts stated in the document. Never invent, estimate or extrapolate a number.
- If a value is not in the document, return "". Never guess.
- Copy figures exactly as written, with their currency symbol, decimals and percent sign.
- Never name the client brand, its products, its promo codes or any person. Say
  "the brand", "the moment", "the bundle". This page is shown to OTHER clients.
- Never use em dashes. Use commas, colons or full stops.
- Never repeat a word ("revenue revenue"). Proof-read every string you emit.

HERO (most common mistake: these get swapped)
- hero.headline: the SHORT punchy claim, under 12 words, no figures.
  Good: "The brand did not need cheaper traffic. It needed bigger orders."
- hero.subhead: the LONGER supporting sentence, may contain figures.
  Good: "One themed bundle, launched as its own moment, delivered $22,669.43 at a $354.21 average order value, 40% above the account baseline."
- hero.statValue: the single biggest headline number, compact. e.g. "$22.7K".
- hero.statCaption: sentence case, lower case first letter, no full stop.
  Good: "in attributed revenue, from a single bundle moment"
  Bad: "IN ATTRIBUTED REVENUE, FROM A SINGLE BUNDLE MOMENT"

STAT CARDS (exactly 3)
- The three metrics the story turns on. label is a clean metric name.
- benchmarkLabel is free text taken from the document: "account average",
  "platform target", "projection", "rest of account".
- multiplier: the result over the benchmark as "~1.4x". Compute it ONLY when
  both are plain numbers. Otherwise "".

SNAPSHOT TILES (4 to 5)
- Secondary figures. ALWAYS include total revenue first if the document states it.
- label must be a clean noun phrase naming the metric. Never a sentence fragment.
  Good: "Revenue", "Purchases", "Cost per purchase", "Adds to cart", "New-acquisition ROAS"
  Bad: "of link clicks", "New-acquisition ROAS held", "22.50% of link clicks"
- value is the number only: "869", "$130.75", "5.15x".

NARRATIVE (exactly 4, headings verbatim)
"The Challenge", "The Approach", "The Results", "The Insight".
- Each paragraphs array holds ONE string of 2 to 4 sentences, 40 to 70 words.
- Condense hard. Keep the argument, drop the detail. These must stay scannable.
- Do not restate every figure; the stat cards already carry them.

COMPARISONS (up to 2) - every field is required
- label: what is being compared.
- campaign/rest: label (short), value (BARE NUMBER for the bar height, e.g. 354.21),
  display (the formatted string, e.g. "$354.21"). NEVER leave value or display empty.
- multiplier: like "~1.4x", the ratio of the two values.
- note: the one or two sentence explanation the document gives for this comparison.

METHODOLOGY
- The attribution/methodology footnote if present. Do NOT prefix it with the word
  "Methodology"; the page already labels the section.

SLACK POST
Write slackPost: the announcement we post to Slack. Follow this approved example's
STRUCTURE and voice exactly, with this case study's facts:

---
One offer test. $56.4K in new revenue.

A men's grooming brand came to us already hitting goal. Healthy account, solid numbers, nothing broken.

The problem? They'd never tested. Same offer, same creative angles, month after month, not by choice, just no bandwidth to try anything else.

So we built one marketing moment: a gift-with-purchase around their best-selling bundle, with the ad creative and a dedicated landing page rebuilt together to tell one continuous story. Click the ad, land on the same promise. Zero gap.

It became the best-converting campaign in the entire account:

• 12.57% LP conversion, account avg: 6.45%
• 3.18% unique outbound CTR, rest of account: 1.90%
• 1.61x incremental ROAS, account avg: 1.16x
• $2,351 avg revenue per ad, 5x the rest of the account

Enough incremental contribution margin to help the business pay down loans and bills.

One moment. Three levers moved together. That's the whole play.
---

Rules for slackPost:
- Open with a two fragment hook: the play, then the headline number.
- Then a short paragraph naming the brand only by category ("A men's grooming brand").
- Then the problem, then what we built. Short paragraphs, plain sentences.
- Then one lead in line ending in a colon, then bullet metrics using "•", each
  with its benchmark.
- Then one line on the business outcome, then a closing two or three fragment line.
- No emoji. No headings. No markdown bold. Do NOT include a URL; it is appended later.`

export interface ExtractedShape {
  industry?: string
  hero?: { headline?: string; subhead?: string; statValue?: string; statCaption?: string }
  statCards?: { label?: string; value?: string; benchmarkValue?: string; benchmarkLabel?: string; multiplier?: string }[]
  snapshotTiles?: { label?: string; value?: string }[]
  narrative?: { heading?: string; paragraphs?: string[] }[]
  comparisons?: {
    label?: string
    campaign?: { label?: string; value?: number | string; display?: string }
    rest?: { label?: string; value?: number | string; display?: string }
    multiplier?: string
    note?: string
  }[]
  methodology?: string
  slackPost?: string
}

// ─── cleaning helpers ────────────────────────────────────────────────────────

/** Collapse an accidental doubled word, e.g. "revenuerevenue" → "revenue". */
function undouble(v: string): string {
  return v.replace(/\b(\w{4,}?)\1\b/gi, '$1')
}

const s = (v: unknown) => (typeof v === 'string' ? undouble(v.trim()) : '')

/** Parse a figure like "$354.21", "2.91%", "1.61x", "$32K" into a number. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!m) return null
  let n = Number(m[0])
  if (!Number.isFinite(n)) return null
  // "$32K" and "$1.2M" are shorthand; without this a K reads as 32, not 32,000.
  const suffix = v.slice(v.indexOf(m[0]) + m[0].length).trim().toUpperCase()
  if (suffix.startsWith('K')) n *= 1_000
  else if (suffix.startsWith('M')) n *= 1_000_000
  return n
}

/**
 * The unit a figure is expressed in. Comparing across units is meaningless: a
 * "2x+" margin against a "$32K" projection is not a 0.1x result, it is two
 * different measures, so we must not emit a multiple for it.
 */
function unitOf(v: string): '$' | '%' | 'x' | '' {
  if (v.includes('$')) return '$'
  if (v.includes('%')) return '%'
  if (/\dx/i.test(v)) return 'x'
  return ''
}

/** Sentence case a caption that arrived shouting. */
function deShout(v: string): string {
  const letters = v.replace(/[^A-Za-z]/g, '')
  if (letters.length < 4) return v
  const upper = (v.match(/[A-Z]/g) ?? []).length
  return upper / letters.length > 0.6 ? v.toLowerCase() : v
}

/**
 * Derive "~1.4x" from a value and its benchmark when the model omitted it.
 * Returns "" unless both figures share a unit and the result actually beats the
 * benchmark: a multiple below 1 would read as a loss on a card framed as a win,
 * so we show nothing rather than something misleading.
 */
function deriveMultiplier(value: string, benchmark: string): string {
  if (unitOf(value) !== unitOf(benchmark)) return ''
  const a = toNumber(value)
  const b = toNumber(benchmark)
  if (a == null || b == null || b === 0) return ''
  const r = a / b
  if (!Number.isFinite(r) || r < 1.05) return ''
  return `~${r >= 10 ? Math.round(r) : r.toFixed(1)}x`
}

/** Strip prose artefacts so a tile label reads as a metric name. */
function cleanLabel(v: string): string {
  return v
    .replace(/^(of|the|a)\s+/i, '')
    .replace(/\s+(held|held at|so far|in total)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const HEADINGS = ['The Challenge', 'The Approach', 'The Results', 'The Insight']

/**
 * Merge a model response onto a blank set of inputs, repairing the mistakes the
 * model reliably makes. Anything missing keeps a valid shape and renders empty
 * for the author to complete, so a partial extraction never breaks the report.
 */
export function normalizeExtracted(parsed: ExtractedShape): ReportInputs {
  const base = emptyInputs('blank')

  // Hero: the model swaps headline and subhead. The headline is the short one.
  let headline = s(parsed.hero?.headline)
  let subhead = s(parsed.hero?.subhead)
  if (headline && subhead && headline.length > subhead.length + 25) {
    ;[headline, subhead] = [subhead, headline]
  }

  const statCards = (parsed.statCards ?? []).slice(0, 4).map((c) => {
    const value = s(c.value)
    const benchmarkValue = s(c.benchmarkValue)
    let multiplier = s(c.multiplier)
    // An echo of the value ("2x+" against "2x+") is noise, not a multiple.
    if (!multiplier || multiplier === value) multiplier = deriveMultiplier(value, benchmarkValue)
    return {
      label: cleanLabel(s(c.label)),
      value,
      benchmarkValue,
      benchmarkLabel: s(c.benchmarkLabel) || 'account average',
      multiplier,
      higherIsBetter: true,
    }
  })

  const tiles = (parsed.snapshotTiles ?? [])
    .map((t) => ({ label: cleanLabel(s(t.label)), value: s(t.value) }))
    .filter((t) => t.label && t.value)
    .slice(0, 6)

  const narrative = HEADINGS.map((heading) => {
    const match = (parsed.narrative ?? []).find(
      (x) => s(x.heading).toLowerCase().trim() === heading.toLowerCase(),
    )
    return { heading, paragraphs: [s(match?.paragraphs?.[0])] }
  })

  const comparisons = (parsed.comparisons ?? []).slice(0, 2).map((c) => {
    const cv = toNumber(c.campaign?.value) ?? toNumber(c.campaign?.display) ?? 0
    const rv = toNumber(c.rest?.value) ?? toNumber(c.rest?.display) ?? 0
    // A bar with no label is a blank chart; fall back to the parsed figure.
    const cd = s(c.campaign?.display) || (cv ? String(cv) : '')
    const rd = s(c.rest?.display) || (rv ? String(rv) : '')
    let multiplier = s(c.multiplier)
    if (!multiplier) multiplier = deriveMultiplier(String(cv), String(rv))
    return {
      label: s(c.label),
      campaign: { label: s(c.campaign?.label) || 'This moment', value: cv, display: cd },
      rest: { label: s(c.rest?.label) || 'Account average', value: rv, display: rd },
      multiplier,
      note: s(c.note),
    }
  })

  return {
    ...base,
    industry: s(parsed.industry),
    hero: {
      headline,
      subhead,
      statValue: s(parsed.hero?.statValue),
      statCaption: deShout(s(parsed.hero?.statCaption)).replace(/\.$/, ''),
    },
    statCards: statCards.length ? statCards : base.statCards,
    snapshotTiles: tiles.length ? tiles : base.snapshotTiles,
    narrative,
    comparisons: comparisons.length ? comparisons : base.comparisons,
    // The section is already titled "Methodology"; drop a repeated prefix.
    methodology: s(parsed.methodology).replace(/^methodology[:\s-]+/i, ''),
    slackPost: s(parsed.slackPost),
  }
}
