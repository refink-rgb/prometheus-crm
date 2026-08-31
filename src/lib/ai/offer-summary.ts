import { GoogleGenAI } from '@google/genai'

// Turning an offer into bullets an editor can scan.
//
// offer_description averages 985 characters and reaches 2,512 — on the Creatives
// tab it is a wall of text between an editor and the one thing they need, which
// is the mechanic. This is a READING AID and never ad copy: it is labelled as
// such wherever it renders, and it deliberately reuses none of the ad-copy
// prompt so nothing here can be mistaken for a headline.
const MODEL = 'gemini-2.5-flash'

function client() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')
  return new GoogleGenAI({ apiKey })
}

const PROMPT = `You are summarising an ecommerce promotional offer for an internal creative team.

Return 3 to 6 short bullet points that let a designer understand the offer without reading the original.

RULES
- Each bullet is one fact, under 15 words, plain language.
- Lead with the mechanic (what someone does to get the deal), then the numbers, then any condition or exclusion.
- Keep every number, price, percentage, code and date EXACTLY as written. Never round, never recompute, never convert.
- If the offer states a condition, a minimum spend, an exclusion or an end date, one bullet must carry it.
- Do NOT write marketing copy. No slogans, no adjectives, no exclamation marks. This is a summary, not a headline.
- Do not invent anything that is not in the text.

Return ONLY a JSON array of strings. No prose, no code fence.`

export async function summariseOffer(offerText: string): Promise<string[]> {
  const res = await client().models.generateContent({
    model: MODEL,
    contents: `${PROMPT}\n\n--- OFFER ---\n${offerText}`,
    config: { responseMimeType: 'application/json' },
  })
  const raw = res.text ?? '[]'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The model did not return a usable summary. Try again.')
  }
  if (!Array.isArray(parsed)) throw new Error('The model did not return a list.')
  const bullets = parsed
    .filter((x): x is string => typeof x === 'string')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 6)
  if (!bullets.length) throw new Error('The model returned an empty summary.')
  return bullets
}
