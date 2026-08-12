// Turn an uploaded brand guideline into something Gemini can read.
//
// PDFs go to the model as bytes, not text. A brand book carries most of its
// substance as artwork — colour swatches, type specimens, logo lockups, grid
// diagrams — and a text-layer extraction returns page furniture while silently
// dropping the entire visual system. Gemini reads PDF pages natively, so the
// swatch on page 14 is actually looked at.
//
// DOCX and PPTX have no such path, so they are flattened to text and the
// caller is told the visual pages were not seen (see NOTE_TEXT_ONLY).

export type GuidelinePayload =
  | { kind: 'pdf'; base64: string; mimeType: string; bytes: number }
  | { kind: 'text'; text: string; bytes: number }

export const GUIDELINE_ACCEPT = '.pdf,.docx,.pptx'

// Inline request payloads to Gemini cap out around 20MB including overhead.
// Above this the Files API would be needed; refusing with a clear message
// beats a truncated read the user never learns about.
export const MAX_GUIDELINE_BYTES = 18 * 1024 * 1024

export const NOTE_TEXT_ONLY =
  'This document was read as text only — swatches, type specimens and logo artwork on its pages were NOT visible to you. Do not state a hex code, typeface or logo rule unless it appears in the text below. Where the text is silent on the visual system, say so.'

function extension(filename: string): string {
  return (filename.split('.').pop() || '').toLowerCase()
}

/** Strip XML tags to readable text, keeping paragraph breaks. */
function xmlToText(xml: string): string {
  return xml
    // PPTX rows/paragraphs — insert breaks before dropping the tags.
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function pptxToText(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)

  // ppt/slides/slide12.xml — sort numerically so slide 2 precedes slide 10 and
  // the page numbers we cite line up with what the user sees in PowerPoint.
  const slides = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.match(/slide(\d+)\.xml$/)![1], 10)
      return n(a) - n(b)
    })

  const parts: string[] = []
  for (const [i, name] of slides.entries()) {
    const xml = await zip.files[name].async('string')
    const text = xmlToText(xml)
    if (text) parts.push(`--- Slide ${i + 1} ---\n${text}`)
  }
  return parts.join('\n\n')
}

async function docxToText(buf: ArrayBuffer): Promise<string> {
  // mammoth's node entry is CommonJS; depending on bundler interop the callable
  // lands on `.default` or on the namespace itself. Same guard as
  // GenerateReportPanel uses for the browser build.
  const mod = await import('mammoth')
  const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod
  if (typeof mammoth?.extractRawText !== 'function') {
    throw new Error('DOCX reader failed to load. Export the guideline as a PDF and re-upload.')
  }
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) })
  return value.trim()
}

/**
 * Read a guideline file into a Gemini-ready payload.
 *
 * Legacy binary .doc and .ppt are rejected rather than half-parsed: mammoth and
 * the OOXML zip readers only understand the modern formats, and a silent empty
 * extraction would look like a brand book with nothing in it.
 */
export async function parseGuideline(
  filename: string,
  buf: ArrayBuffer,
): Promise<GuidelinePayload> {
  const bytes = buf.byteLength
  if (bytes === 0) throw new Error('The uploaded file is empty.')
  if (bytes > MAX_GUIDELINE_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(1)
    throw new Error(
      `That guideline is ${mb}MB — the limit is ${MAX_GUIDELINE_BYTES / 1024 / 1024}MB. Export a lighter PDF (downsample the images) and try again.`,
    )
  }

  const ext = extension(filename)

  if (ext === 'pdf') {
    return {
      kind: 'pdf',
      base64: Buffer.from(buf).toString('base64'),
      mimeType: 'application/pdf',
      bytes,
    }
  }

  if (ext === 'docx' || ext === 'pptx') {
    const text = ext === 'docx' ? await docxToText(buf) : await pptxToText(buf)
    if (!text || text.length < 40) {
      throw new Error(
        `No readable text found in that ${ext.toUpperCase()}. If the guideline is mostly artwork, export it as a PDF — PDF pages are read visually, so swatches and type specimens come through.`,
      )
    }
    return { kind: 'text', text, bytes }
  }

  if (ext === 'doc' || ext === 'ppt') {
    throw new Error(
      `Legacy .${ext} files can't be read. Save it as .${ext}x or export a PDF and re-upload.`,
    )
  }

  throw new Error(`Unsupported file type ".${ext}". Upload a PDF, DOCX or PPTX.`)
}
