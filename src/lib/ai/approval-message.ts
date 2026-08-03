// Client approval message generation for the Offer Cycle.
//
// Turns an offer card's fields into the message a strategist sends the client
// to get the offer signed off. Lives here rather than in gemini.ts because the
// prompt is the feature — gemini.ts is the transport, and this file is the
// only place the message's shape is defined.
//
// Why a model and not a string template: the paragraph that actually earns the
// approval is the one justifying *why this specific mechanic* — synthesised
// across the problem statement, the offer description and the price. A
// template can only concatenate those three, which reads like a form, not like
// someone who thought about the client's business.
//
// The hard constraint, encoded all over the prompt: never invent a number.
// Every figure in this message is quoted back to a client as something we said,
// so a hallucinated benchmark is not a copy problem, it's a trust problem.

import { GoogleGenAI } from '@google/genai'

const MODEL = 'gemini-2.5-flash'

function client() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')
  return new GoogleGenAI({ apiKey })
}

const SYSTEM_PROMPT = `You are a senior growth strategist at a marketing agency, writing to a client — the brand's owner or marketing lead — to get one proposed offer approved. What you write gets pasted straight into an email or a Slack DM, so it must read as finished writing by a person who has thought hard about this specific business.

THE ONE RULE THAT OVERRIDES EVERYTHING ELSE
Every digit you write must already appear in the offer card below. You may quote its figures, and you may restate one in different units only when the card itself gives you both parts. You may not invent, estimate, extrapolate, round, infer or "reasonably assume" any number — not a percentage, a benchmark, an industry average, a projection, a lift, a date, a timeline or a count of anything. There is no figure you can add that is worth more than the client trusting the ones that are real, and every number here gets read back to us as something we claimed. If a sentence would be stronger with a number you were not given, write the weaker sentence. If a whole section needs a number you do not have, cut the section. An automated check reads every digit in your output against the card and flags anything that is not there, so an invented figure will be caught — but the point is not to get caught, it is that a message with a made-up number in it is worse than no message.

WHAT MAKES THIS MESSAGE WORK
A client approves when they follow the reasoning, not when they are sold to. Lead with the problem in their own numbers, explain why this particular mechanic answers it, and be explicit about what success looks like and what would stop it. Confidence comes from specificity. It never comes from adjectives.

STRUCTURE
Follow this order. Drop any section whose source data is missing rather than padding it.

1. Opening, 2-4 sentences. Start with the concrete problem — the actual figure or the specific observation in the problem statement. Then say in one line what you are proposing. If the brand has a positioning constraint this offer respects (no discounting, price integrity, premium shelf position), name it here so the client knows you did not forget it. Never open with "we've been digging into the data" or any variant of announcing that you looked at something: earn the attention with the finding itself.

2. The mechanic, one line. Name the offer plainly, and where it runs.

3. Header "Why this shape" — one prose paragraph, 40-70 words. Justify the specific number or structure of the offer. If its value can be compared to something the brand already gives away, make that comparison directly; the strongest available argument is almost always that this reshapes value the brand is already spending rather than adding new discount on top. This is the most important paragraph in the message.

4. Header "Why this product" — one prose paragraph of 40-70 words, then 2-3 bullets. The paragraph explains why this product is the one carrying the offer. The bullets are the supporting reasons: under 12 words each, each making a genuinely different point, none of them restating the paragraph.

5. Header "What we're watching" — 2-4 bullets. The success metric and its target. The guardrails, phrased as limits the offer holds itself to rather than as internal policy. Where it runs, if the page type carries meaning. Numbers only from the data you were given.

6. Closing, 1-2 sentences. Say plainly what happens if they approve, and offer one specific alternative to a flat no — a change they could ask for instead — so the reply is either approval or useful direction. Never end with "let us know if you have any questions."

RULES
- The number rule above governs every section. Re-read it before you write section 5.
- A missing field means its section is dropped, not filled with plausible-sounding filler. A short honest message beats a padded one.
- Prose paragraphs carry the reasoning. Bullets carry facts, numbers and limits. Never compress an argument into a bullet, and never let bullets outnumber the prose.
- Write in second person about the client's business: "your AOV", "your best seller". Never refer to them in the third person.
- No greeting line and no sign-off. The strategist adds those.
- Plain text only. No markdown syntax — no asterisks, no hashes, no bold markers. Section headers sit on their own line in sentence case. Bullets start with "- ".
- 280-420 words total.`

/** The card fields the message is built from. Empty ones are simply omitted. */
export type ApprovalMessageInput = {
  brandName: string
  monthLabel: string
  offerDynamicsType: string | null
  offer: string | null
  offerDescription: string | null
  productFeatured: string | null
  productDescription: string | null
  retailPrice: string | null
  pageType: string | null
  problemStatement: string | null
  successMetric: string | null
  successTarget: number | null
  guardrails: string | null
  competitorReference: string | null
  /** Brand DNA context — the client's own positioning, not a voice to imitate. */
  positioning: string | null
  coreValueProp: string | null
  priceAnchor: string | null
}

// Only non-empty fields reach the model. An explicit "not provided" line would
// invite the model to fill the gap; an absent line reads as nothing to say.
function buildCardBlock(input: ApprovalMessageInput): string {
  const lines: string[] = []
  const add = (label: string, value: string | number | null | undefined) => {
    const v = typeof value === 'number' ? String(value) : value?.trim()
    if (v) lines.push(`${label}: ${v}`)
  }

  add('Client / brand', input.brandName)
  add('Moment', input.monthLabel)
  add('Offer type', input.offerDynamicsType)
  add('Offer', input.offer)
  add('Offer mechanics and angle', input.offerDescription)
  add('Featured product', input.productFeatured)
  add('Product description', input.productDescription)
  add('Retail price', input.retailPrice)
  add('Runs on', input.pageType)
  add('Problem this solves', input.problemStatement)
  add('Success metric', input.successMetric)
  add('Target for that metric', input.successTarget)
  add('Guardrails (one per line)', input.guardrails)
  add('Competitor reference', input.competitorReference)
  add("Brand's positioning", input.positioning)
  add('Core value proposition', input.coreValueProp)
  add('Price anchor', input.priceAnchor)

  return lines.join('\n')
}

/**
 * The minimum a message needs to be worth generating. Below this the model has
 * nothing to reason from and would produce confident-sounding filler, which is
 * the one failure mode that actually costs the agency something.
 */
export function canGenerateApprovalMessage(input: ApprovalMessageInput): boolean {
  return Boolean(input.offer?.trim() || input.offerDescription?.trim())
}

// Commas are thousands separators here, never decimal — the card's numeric
// fields come from <input type=number> and its prices are typed by the team.
const stripSeparators = (s: string) => s.replace(/,/g, '')

/**
 * Every figure in the message that does not appear in the card it was built
 * from. This is the real guard against invented numbers: the prompt asks, this
 * checks. Prompt rules are a request, and a model under pressure to write a
 * persuasive sentence will occasionally produce a benchmark that sounds right.
 *
 * It reports rather than blocks, on purpose. A hard reject would throw away a
 * good draft over the "2" in "two-item purchase", and re-rolling until the
 * regex is happy trades one silent failure for another. Naming the exact
 * figures puts the strategist's eye on the four characters that matter,
 * immediately before the one moment they'd otherwise skim.
 *
 * Bare small integers are skipped: prose counts things ("buy 1, get 1"), and
 * flagging those trains the reader to ignore the warning, which costs more
 * than the rare miss. Anything carrying a currency symbol or a percent sign is
 * always checked, since that is the shape a fabricated figure takes.
 */
export function findUnverifiedNumbers(message: string, input: ApprovalMessageInput): string[] {
  const haystack = stripSeparators(buildCardBlock(input))
  const found = new Map<string, string>()

  const pattern = /(\$|€|£)?(\d[\d,]*(?:\.\d+)?)\s*(%)?/g
  for (const m of message.matchAll(pattern)) {
    const [, currency, rawDigits, percent] = m
    const digits = stripSeparators(rawDigits)
    if (haystack.includes(digits)) continue

    const marked = Boolean(currency || percent)
    const n = Number(digits)
    if (!marked && Number.isInteger(n) && n <= 3) continue

    const display = `${currency ?? ''}${rawDigits}${percent ?? ''}`
    found.set(display, display)
  }

  return Array.from(found.values())
}

export type GeneratedApprovalMessage = {
  text: string
  /** Figures in `text` with no source in the card. Empty is the normal case. */
  unverifiedNumbers: string[]
}

export async function generateApprovalMessageText(
  input: ApprovalMessageInput,
): Promise<GeneratedApprovalMessage> {
  const ai = client()

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: `${SYSTEM_PROMPT}\n\n---\n\nOffer card:\n\n${buildCardBlock(input)}\n\nWrite the message.`,
    // Warm enough to write prose rather than fill slots, cool enough that two
    // runs on the same card don't argue different cases.
    config: { temperature: 0.7 },
  })

  const raw = res.text?.trim() ?? ''
  if (!raw) throw new Error('Gemini returned an empty approval message.')

  // Belt and braces on the "no markdown" rule — the model reaches for ** on
  // headers often enough that stripping is cheaper than re-rolling.
  const text = raw.replace(/\*\*/g, '').replace(/^#{1,6}\s+/gm, '')

  return { text, unverifiedNumbers: findUnverifiedNumbers(text, input) }
}
