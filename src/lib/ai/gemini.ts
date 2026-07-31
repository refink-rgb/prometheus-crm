import { GoogleGenAI } from '@google/genai'
import { brandDnaResponseSchema, type BrandDnaJson } from './brand-dna-schema'
import { formatPaletteForPrompt, type SitePalette } from './palette'

const MODEL = 'gemini-2.5-flash'

function client() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')
  return new GoogleGenAI({ apiKey })
}

function researchPrompt(brandName: string, websiteUrl: string): string {
  return `You are a senior brand strategist doing pre-production research for ${brandName} (${websiteUrl}), ahead of building their Brand DNA reference document. This turn is research only — a separate pass will structure your findings into a schema, so write a dossier a design/creative team could act on directly.

Research, roughly in this order:
1. External search — design credits, brand guidelines/press kit, "what font does ${brandName} use", brand color / hex codes, packaging design or unboxing, campaign photography/lookbook/editorial, brand story/mission/positioning. If a named design agency case study surfaces (Pentagram, COLLINS, Mast, Order, Manual, or similar), treat it as your highest-priority source — it usually states exact fonts, hex codes, and rationale the brand's own site won't.
2. Site fetch — the homepage, plus About, a product page, and a Story/Mission page if they exist. Pull image alt text, headline/body typography treatment, CTA styling, layout density, and packaging detail from what's actually rendered.
   Note: if a page comes back thin or mostly empty (e.g. a JS-heavy storefront), say so and lean on external sources instead of guessing from a shell.
3. Competitors — identify 2-3 direct competitors from what you've found (or search "${brandName} vs competitors"). For each, name one specific visual or verbal axis where ${brandName} sits opposite them — not "more premium," the actual choice that makes it so.

Ground every claim in something you actually found — a quote, a hex code, a named font, a specific image description. If you can't confirm something, write "not found" rather than inferring from category norms (e.g. don't assume "all skincare brands shoot on white").

Write your findings as a markdown dossier with these exact section headers: Brand Overview, Visual System, Photography, Packaging, Ad Creative Style, Sales DNA. Cite the source URL inline next to each claim. Aim for 700-900 words — dense with specifics, not padded.`
}

const SYNTHESIS_PROMPT = `You are structuring a brand research dossier into a Brand DNA record. You'll receive the dossier as input — extract and structure it, don't add new claims.

Rules:
- Every field must trace to something stated in the dossier. If the dossier says "not found" or doesn't cover it, output "" for text fields or [] for array fields — never invent a plausible-sounding value.
- Color fields (primary_color, secondary_color, accent_color, background_colors, contrast_color): output exact "#rrggbb" hex codes, never bare color names like "green". When an "extracted site palette" block is appended below, treat it as ground truth: choose each color field's value from that list (or a hex stated verbatim in the dossier), using the CSS variable-name hints, usage counts, and the dossier's color descriptions to assign roles — e.g. if the dossier says the brand color is forest green and the palette has one dark green hinted as --color-primary, that hex is primary_color. High-count near-whites/creams belong in background_colors; the dominant text color is usually contrast_color. If neither the palette nor the dossier yields a usable hex for a field, output "" — do not invent one from memory.
- voice_adjectives: exactly 5, each meaningfully distinct — no near-synonyms ("bold, confident, assertive" counts as one register, not three).
- competitive_differentiation: name the specific competitors from the dossier, not "other brands in the category."
- proof_points: only exact figures explicitly stated in the dossier.
- prompt_modifier: write this yourself — a 50-75 word paragraph combining primary_color, primary_font, photography mood, lighting, and color_grading into one paragraph a designer would prepend to an ad-generation prompt to lock in visual consistency. This is the most important field.
- sources: one {url, field, note} entry per field you were able to confirm, pulled from the URLs cited in the dossier. Prefer URLs from the "URLs retrieved during research" list appended below.
- research_markdown: pass the dossier through essentially unchanged.`

export type ResearchResult = {
  dossier: string
  urls: string[]
}

export async function researchBrandDna(brandName: string, websiteUrl: string): Promise<ResearchResult> {
  const ai = client()
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: researchPrompt(brandName, websiteUrl),
    config: {
      tools: [{ googleSearch: {} }, { urlContext: {} }],
    },
  })

  const dossier = res.text ?? ''
  if (!dossier.trim()) throw new Error('Gemini research call returned empty text.')

  const urls = new Set<string>()
  const cand = res.candidates?.[0]
  cand?.groundingMetadata?.groundingChunks?.forEach(c => {
    const u = c.web?.uri
    if (u) urls.add(u)
  })
  cand?.urlContextMetadata?.urlMetadata?.forEach(m => {
    if (m.retrievedUrl) urls.add(m.retrievedUrl)
  })

  return { dossier, urls: Array.from(urls) }
}

export type CopyDeck = {
  headlines: string[]
  eyebrows: string[]
  subheads: string[]
}

export async function generateAdCopy(
  offer: string,
  brandName: string,
  promptModifier: string,
): Promise<CopyDeck> {
  const ai = client()
  const voiceHint = promptModifier.trim()
    ? `\nBrand voice / visual direction: ${promptModifier}`
    : ''

  const prompt = `You are a direct-response copywriter specializing in Meta/Instagram ads.

Brand: ${brandName}${voiceHint}

Offer: ${offer}

Generate ad copy in exactly this JSON format — no commentary, just the object:
{
  "headlines": [8 strings, 5-9 words each, punchy, benefit-first, varied angles: value/curiosity/social proof/urgency],
  "eyebrows": [5 strings, 1-4 words each, ALL-CAPS style, e.g. "LIMITED OFFER", "NEW ARRIVAL"],
  "subheads": [4 strings, 10-18 words each, one supporting benefit or reason-to-believe per line]
}`

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  })

  const text = res.text ?? ''
  if (!text.trim()) throw new Error('Gemini copy generation returned empty text.')

  try {
    return JSON.parse(text) as CopyDeck
  } catch {
    throw new Error('Gemini copy generation returned invalid JSON.')
  }
}

export async function synthesizeBrandDna(
  dossier: string,
  urls: string[],
  palette: SitePalette | null = null,
): Promise<BrandDnaJson> {
  const ai = client()
  const urlBlock = urls.length
    ? `\n\nURLs retrieved during research (use these for the sources array where they match a field):\n${urls.map(u => `- ${u}`).join('\n')}`
    : ''
  const paletteBlock = palette && palette.colors.length
    ? `\n\n---\n\n${formatPaletteForPrompt(palette)}`
    : ''

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: `${SYNTHESIS_PROMPT}\n\n---\n\nDossier:\n\n${dossier}${urlBlock}${paletteBlock}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: brandDnaResponseSchema,
    },
  })

  const text = res.text ?? ''
  if (!text.trim()) throw new Error('Gemini synthesis call returned empty text.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Gemini synthesis returned invalid JSON.')
  }

  return parsed as BrandDnaJson
}

// Restructure a written case study into the marketing-report slots. Extraction
// only: the model may not invent a figure, because every number ends up on a
// page we send to prospects. Missing values come back empty for the author to
// complete in the form.
export async function extractCaseStudy(systemPrompt: string, document: string): Promise<unknown> {
  const ai = client()
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: `${systemPrompt}\n\n---\n\nCase study document:\n\n${document}\n\nReturn a single JSON object with the fields described.`,
    config: { responseMimeType: 'application/json', temperature: 0 },
  })

  const text = res.text ?? ''
  if (!text.trim()) throw new Error('Gemini returned empty text.')

  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Gemini returned invalid JSON.')
  }
}
