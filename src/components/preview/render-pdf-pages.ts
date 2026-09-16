// Page previews for PDF briefs, drawn in the BROWSER.
//
// Not on the server: sharp cannot open a PDF, and server-side pdf.js needs a
// 35MB native canvas binary plus fonts Vercel lacks. The browser has a canvas.
//
// Loaded at runtime from /public/pdfjs (scripts/copy-pdfjs.mjs), never bundled:
// the library and worker reach only someone handling a PDF brief. LEGACY build:
// the modern one calls Map.prototype.getOrInsertComputed and Math.sumPrecise
// with no polyfill.
//
// Rendering nearly stops in a hidden tab (measured: 2 of 30 pages in ~50s), so
// this runs while the person is looking: right after their upload, or on
// "Make page previews". Never as background work.

import type * as PdfJs from 'pdfjs-dist'

type PdfJsModule = typeof PdfJs
let loader: Promise<PdfJsModule> | null = null

function loadPdfJs(): Promise<PdfJsModule> {
  if (!loader) {
    const src = '/pdfjs/pdf.min.js'
    loader = (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ src) as Promise<PdfJsModule>)
      .then(mod => {
        mod.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js'
        return mod
      })
    loader.catch(() => { loader = null })
  }
  return loader
}

export interface RenderedPage { n: number; w: number; h: number; full: Blob; thumb: Blob }

export async function renderPdfPreviews(opts: {
  source: { data: ArrayBuffer } | { url: string }
  maxPages: number
  fullPx: number
  thumbPx: number
  /** Called once the page count is known, before the first page is drawn. */
  prepare: (pageNumbers: number[], ext: 'webp' | 'jpg') => Promise<void>
  onPage: (page: RenderedPage) => Promise<void>
  onProgress: (done: number, total: number) => void
}): Promise<{ pageCount: number; ext: 'webp' | 'jpg' }> {
  const pdfjs = await loadPdfJs()
  const enc = await pickEncoding()

  let data: Uint8Array
  if ('data' in opts.source) {
    data = new Uint8Array(opts.source.data.slice(0))   // pdf.js detaches what it is given
  } else {
    const res = await fetch(opts.source.url)
    if (!res.ok) throw new Error(`Could not fetch the PDF (HTTP ${res.status}).`)
    data = new Uint8Array(await res.arrayBuffer())
  }

  // No isEvalSupported: pdf.js v6 removed the option along with the eval-based
  // font path it guarded, so untrusted client PDFs are already safe here.
  // destroy() lives on the LOADING TASK in v6, not the document — keep it.
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  })

  // Inside the try: a password-protected or broken PDF rejects here, and its
  // worker (holding a copy of the file) must still be destroyed.
  try {
    const doc = await task.promise
    const total = Math.min(doc.numPages, opts.maxPages)
    const numbers = Array.from({ length: total }, (_, i) => i + 1)
    await opts.prepare(numbers, enc.ext)

    for (const n of numbers) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: opts.fullPx / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const full = await toBlob(canvas, enc.type, 0.8)

      const k = Math.min(1, opts.thumbPx / Math.max(canvas.width, canvas.height))
      const small = document.createElement('canvas')
      small.width = Math.max(1, Math.round(canvas.width * k))
      small.height = Math.max(1, Math.round(canvas.height * k))
      const ctx = small.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(canvas, 0, 0, small.width, small.height)
      const thumb = await toBlob(small, enc.type, 0.75)

      const w = canvas.width
      const h = canvas.height
      canvas.width = canvas.height = 0   // release ~13MB of pixels now, not at GC
      small.width = small.height = 0
      page.cleanup()

      await opts.onPage({ n, w, h, full, thumb })
      opts.onProgress(n, total)
    }
    return { pageCount: doc.numPages, ext: enc.ext }
  } finally {
    await task.destroy()
  }
}

export function pdfErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'PasswordException') {
    return 'This PDF is password-protected, so page previews cannot be made. Upload an unprotected copy (open it, Print, then Save as PDF).'
  }
  if (name === 'InvalidPDFException') return 'This file is not a readable PDF (it may be damaged).'
  if (/Failed to fetch|NetworkError|Load failed|dynamically imported module/i.test(msg)) {
    return 'Could not load the PDF or the preview renderer. Check the connection, then Make page previews again.'
  }
  return `Page previews failed: ${msg.slice(0, 160)}`
}

// Browsers that cannot encode WebP silently return PNG. JPEG is universal.
async function pickEncoding(): Promise<{ type: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg' }> {
  const c = document.createElement('canvas')
  c.width = c.height = 2
  const probe = await new Promise<Blob | null>(r => c.toBlob(r, 'image/webp', 0.8))
  return probe?.type === 'image/webp' ? { type: 'image/webp', ext: 'webp' } : { type: 'image/jpeg', ext: 'jpg' }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The browser could not encode a page image.'))), type, quality))
}
