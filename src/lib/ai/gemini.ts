import { GoogleGenAI } from '@google/genai'
import { brandDnaResponseSchema, type BrandDnaJson } from './brand-dna-schema'
import { NOTE_TEXT_ONLY, type GuidelinePayload } from './brand-guideline'
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

function guidelinePrompt(brandName: string, textOnlyNote: string): string {
  return `You are a senior brand strategist reading ${brandName}'s own brand guideline document, ahead of building their Brand DNA reference. This turn is extraction only — a separate pass will structure your findings into a schema, so write a dossier a design/creative team could act on directly.

This document is first-party: what it states is the specification, not an inference. Your job is to report it accurately, not to improve on it.
${textOnlyNote}
Work through the WHOLE document, not the opening pages — palettes, photography direction and tone-of-voice usually sit in the back half. Read the artwork on each page as carefully as the body copy: colour chips, type specimens, logo lockups, grid diagrams and photography boards carry most of the system and often have no text at all.

Pull out, citing the page or slide number for each claim:
1. Overview — positioning, tagline, stated values or personality attributes, any named design agency, any competitor set the document itself names.
2. Visual system — every colour swatch with its exact hex (plus CMYK/RGB/Pantone where printed) and its stated role (primary, secondary, accent, neutral, background); typefaces with foundry and licensed weights; the type scale, casing and letter-spacing rules; CTA/button styling.
3. Logo — lockup variants, minimum size, clear-space rule, and the misuse list.
4. Photography — lighting, grading, composition, subject matter, stated treatments, and anything explicitly ruled out.
5. Packaging — materials, finishes, label anatomy, placement rules.
6. Ad creative and voice — formats, overlay style, offer presentation, "say this not that" tables, banned words, naming and punctuation rules.
7. Sales DNA — pain points, proof points with their exact figures, offers, price anchors, objections, hooks. Only what the document states.

Where a swatch is shown without a hex printed next to it, say so and describe the colour rather than guessing a value — a wrong hex propagates into every ad we build. If the document is a partial extract, an old version, or covers only one sub-brand, say that up front. Never fill a gap from category norms or from what you know about this brand from elsewhere; write "not stated in the guideline" instead.

Write your findings as a markdown dossier with these exact section headers: Brand Overview, Visual System, Photography, Packaging, Ad Creative Style, Sales DNA. Aim for 700-900 words — dense with specifics, not padded.`
}

/**
 * Build the research dossier from the brand's own guideline document instead of
 * from public sources. Returns the same shape as `researchBrandDna` so the
 * synthesis pass is shared: only the provenance of the dossier differs.
 *
 * `urls` comes back empty — a first-party document has no source URLs, and the
 * synthesis prompt already tolerates an empty list.
 */
export async function readBrandGuideline(
  brandName: string,
  doc: GuidelinePayload,
): Promise<ResearchResult> {
  const ai = client()

  const prompt = guidelinePrompt(
    brandName,
    doc.kind === 'text' ? `\n${NOTE_TEXT_ONLY}\n` : '',
  )

  const parts =
    doc.kind === 'pdf'
      ? [{ inlineData: { mimeType: doc.mimeType, data: doc.base64 } }, { text: prompt }]
      : [{ text: `${prompt}\n\n---\n\nGuideline document contents:\n\n${doc.text.slice(0, 200_000)}` }]

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { temperature: 0 },
  })

  const dossier = res.text ?? ''
  if (!dossier.trim()) throw new Error('Gemini returned nothing for that guideline document.')

  return { dossier, urls: [] }
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
  provenance: string | null = null,
): Promise<BrandDnaJson> {
  const ai = client()
  const urlBlock = urls.length
    ? `\n\nURLs retrieved during research (use these for the sources array where they match a field):\n${urls.map(u => `- ${u}`).join('\n')}`
    : ''
  const paletteBlock = palette && palette.colors.length
    ? `\n\n---\n\n${formatPaletteForPrompt(palette)}`
    : ''
  const provenanceBlock = provenance ? `\n\n${provenance}` : ''

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: `${SYNTHESIS_PROMPT}${provenanceBlock}\n\n---\n\nDossier:\n\n${dossier}${urlBlock}${paletteBlock}`,
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

/**
 * One detected brand mark. Edges are NAMED rather than a positional array:
 * the conventional `box_2d` tuple is [ymin, xmin, ymax, xmax], y before x,
 * and reading it in the other order silently rotates every region 90° — wide
 * lines of text come back as tall narrow bars. Naming the axes removes the
 * chance of that entirely. All values are 0–1000 of the image passed in.
 */
export type DetectedMark = { x0: number; y0: number; x1: number; y1: number; what: string }

/**
 * Locate every visible occurrence of a brand's identity in an image, so the
 * showcase page can blur it. Recall matters far more than precision here: a
 * missed wordmark de-anonymizes a client, while a spurious box only blurs a
 * patch of a stock photo. The prompt is written accordingly.
 */
export async function detectBrandMarks(
  imageBase64: string,
  mimeType: string,
  brandName: string,
): Promise<DetectedMark[]> {
  const ai = client()

  const prompt = `You are redacting a client's identity from a marketing case study that will be sent to other prospects. Nothing that identifies the brand "${brandName}" may remain readable.

What you are looking for above all is the LOGO: the word "${brandName}" drawn as the brand's own mark — its letters styled, stretched, outlined, filled or set inside a badge, roundel, ribbon or icon, often in the page header, the footer, or printed on the product. It still reads as the word "${brandName}" even when the lettering is heavily stylised. That is the single most important thing to find, at any size.

Also find every region containing:
- the name "${brandName}" as ordinary text — headline, eyebrow, body copy, caption, button, table cell
- a web address, handle, email or hashtag containing "${brandName}"
- "${brandName}" printed on a product, package, label, garment or signage in the photo

Include occurrences that are small, blurry, partly hidden, low-contrast, cropped by the image edge, or already partially obscured. Include each occurrence separately rather than one box around several. If you are unsure whether a region is the brand, INCLUDE it — a false positive is harmless, a miss is not.

Do NOT box sub-brand or product names that do not contain "${brandName}".

Box each occurrence TIGHTLY — the smallest rectangle that still contains the whole mark. Do not include the surrounding graphic, card, photo or paragraph it sits in. A line of text is a wide, short box.

Return JSON only:
{"marks":[{"left":0,"top":0,"right":0,"bottom":0,"what":"short neutral description, e.g. 'headline text' or 'logo bottom right'"}]}
where left/right are horizontal distances from the LEFT edge and top/bottom are vertical distances from the TOP edge, each 0-1000 of this image's width and height respectively. Return {"marks":[]} if there are none.`

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] },
    ],
    config: { responseMimeType: 'application/json', temperature: 0 },
  })

  const text = res.text ?? ''
  if (!text.trim()) return []

  type RawMark = {
    left?: number
    top?: number
    right?: number
    bottom?: number
    /** Older/again-conventional shape, kept so a stray tuple still parses. */
    box_2d?: number[]
    what?: string
  }
  let parsed: { marks?: RawMark[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Gemini brand-mark detection returned invalid JSON.')
  }

  const num = (n: unknown): number | null =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : null

  return (parsed.marks ?? []).flatMap((m): DetectedMark[] => {
    let edges: (number | null)[]
    if (m.box_2d && Array.isArray(m.box_2d) && m.box_2d.length === 4) {
      // Tuple form is y-first by convention.
      const [ymin, xmin, ymax, xmax] = m.box_2d
      edges = [num(xmin), num(ymin), num(xmax), num(ymax)]
    } else {
      edges = [num(m.left), num(m.top), num(m.right), num(m.bottom)]
    }
    if (edges.some((n) => n === null)) return []
    const [a, b, c, d] = edges as number[]
    // Sort each axis: a model that reports edges reversed should not produce a
    // negative-size region that later reads as zero.
    const x0 = Math.min(a, c)
    const x1 = Math.max(a, c)
    const y0 = Math.min(b, d)
    const y1 = Math.max(b, d)
    if (x1 <= x0 || y1 <= y0) return []
    return [{ x0, y0, x1, y1, what: m.what ?? 'brand mark' }]
  })
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
