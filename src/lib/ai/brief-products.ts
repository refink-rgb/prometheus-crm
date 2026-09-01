import { GoogleGenAI } from '@google/genai'

// Reading the product structure out of a brief.
//
// A brief names its products in prose — "Bundle 1: the tube, the rope and the
// vest; Bundle 2 adds the speaker" — and product_featured is a single line an
// account manager typed, sometimes semicolon-separated, sometimes comma-
// separated, sometimes one long phrase. The structure is there; it has just
// never been anywhere a program could read.
//
// This PROPOSES that structure. It never writes: the caller hands the result to
// the editor pre-filled, and a person saves it. 179 products already exist and
// some have been curated by hand — a model is not allowed to overwrite them
// because someone clicked a button once.
const MODEL = 'gemini-2.5-flash'

function client() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')
  return new GoogleGenAI({ apiKey })
}

export interface ProposedProduct {
  name: string
  group: string | null
  url: string | null
}

const PROMPT = `You are reading an ecommerce campaign brief and extracting the products it advertises.

Return a JSON array. Each element is an object:
  { "name": string, "group": string | null, "url": string | null }

RULES
- "name" is ONE product, as a person would say it. Never a list, never a sentence.
- "group" is the bundle or tier it belongs to, using the brief's OWN wording — "Bundle 1", "Tier 2", "Build Your Own". If the brief does not group its products, set group to null for every product. Do NOT invent groups.
- A product that appears in two bundles gets one entry per bundle.
- "url" only if the brief literally contains a link for that product. Otherwise null. Never guess or construct a URL.
- Copy names VERBATIM, including colours, pack sizes and variant codes: "Water Walkway (Red, 2-Pack)" stays exactly that. A comma inside a name is part of the name.
- Do not invent products. If the brief names a collection rather than specific SKUs ("all jeans"), return that one entry as written.
- Do not include the offer, the discount, or the campaign name as a product.

Return ONLY the JSON array. No prose, no code fence.`

export async function extractProductsFromBrief(brief: string): Promise<ProposedProduct[]> {
  const res = await client().models.generateContent({
    model: MODEL,
    contents: `${PROMPT}\n\n--- BRIEF ---\n${brief}`,
    config: { responseMimeType: 'application/json' },
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(res.text ?? '[]')
  } catch {
    throw new Error('The model did not return a usable list. Try again.')
  }
  if (!Array.isArray(parsed)) throw new Error('The model did not return a list.')

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return parsed
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
    .map(el => ({
      name: str(el.name),
      group: str(el.group) || null,
      // Same rule as everywhere else: only http(s) reaches an href.
      url: /^https?:\/\//i.test(str(el.url)) ? str(el.url) : null,
    }))
    .filter(x => x.name.length > 0)
    .slice(0, 40)
}
