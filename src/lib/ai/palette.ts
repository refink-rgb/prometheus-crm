import * as cheerio from 'cheerio'

// Extracts the real color palette from a brand's live site by reading its CSS,
// so Brand DNA color fields hold exact hex codes instead of names like "green".
// Purely mechanical — no AI. The result is handed to the Gemini synthesis pass
// as ground truth; role assignment (primary vs accent) stays with the model.

export type PaletteEntry = {
  hex: string
  count: number
  hints: string[] // CSS custom-property names that use this color, e.g. --brand-green
}

export type SitePalette = {
  themeColor: string | null // <meta name="theme-color">
  colors: PaletteEntry[]    // sorted by frequency, capped
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_STYLESHEETS = 8
const MAX_CSS_BYTES = 600_000
const MAX_COLORS = 30
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PrometheusCRM-BrandDNA/1.0'

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,text/css,*/*' },
      redirect: 'follow',
    })
    if (!res.ok) return ''
    const text = await res.text()
    return text.length > MAX_CSS_BYTES ? text.slice(0, MAX_CSS_BYTES) : text
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

function normalizeHex(raw: string): string | null {
  let h = raw.replace('#', '').toLowerCase()
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6 || /[^0-9a-f]/.test(h)) return null
  return `#${h}`
}

function rgbToHex(r: number, g: number, b: number): string | null {
  if ([r, g, b].some(v => v < 0 || v > 255 || Number.isNaN(v))) return null
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function harvestColors(css: string, counts: Map<string, number>, hints: Map<string, Set<string>>) {
  // #abc / #aabbcc
  for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = normalizeHex(m[0])
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  // rgb()/rgba() with numeric channels
  for (const m of css.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]))
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  // Custom properties whose NAME suggests a brand role: --primary-color: #xxx
  const hintRe = /--([a-z0-9_-]*(?:color|colour|primary|secondary|accent|brand|background|bg|theme)[a-z0-9_-]*)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi
  for (const m of css.matchAll(hintRe)) {
    const name = `--${m[1].toLowerCase()}`
    let hex: string | null = null
    if (m[2].startsWith('#')) {
      hex = normalizeHex(m[2].slice(0, 7))
    } else {
      const rgb = m[2].match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/)
      if (rgb) hex = rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))
    }
    if (!hex) continue
    if (!hints.has(hex)) hints.set(hex, new Set())
    hints.get(hex)!.add(name)
  }
}

export async function extractSitePalette(websiteUrl: string): Promise<SitePalette | null> {
  let base: URL
  try {
    base = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`)
  } catch {
    return null
  }

  const html = await fetchText(base.href)
  if (!html) return null

  const $ = cheerio.load(html)
  const counts = new Map<string, number>()
  const hints = new Map<string, Set<string>>()

  const themeColor = normalizeHex($('meta[name="theme-color"]').attr('content') ?? '')

  // Inline <style> blocks and style="" attributes on the rendered page
  $('style').each((_, el) => harvestColors($(el).text(), counts, hints))
  $('[style]').each((_, el) => harvestColors($(el).attr('style') ?? '', counts, hints))

  // Linked stylesheets (theme CSS is where the real brand palette lives)
  const sheetUrls: string[] = []
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      sheetUrls.push(new URL(href, base).href)
    } catch { /* skip malformed */ }
  })

  const sheets = await Promise.all(sheetUrls.slice(0, MAX_STYLESHEETS).map(fetchText))
  sheets.forEach(css => harvestColors(css, counts, hints))

  if (counts.size === 0 && !themeColor) return null

  const colors: PaletteEntry[] = Array.from(counts.entries())
    .map(([hex, count]) => ({ hex, count, hints: Array.from(hints.get(hex) ?? []) }))
    // Hinted colors first regardless of count — a --brand-* variable used once
    // matters more than a utility gray used 400 times.
    .sort((a, b) => (b.hints.length - a.hints.length) || (b.count - a.count))
    .slice(0, MAX_COLORS)

  return { themeColor, colors }
}

export function formatPaletteForPrompt(palette: SitePalette): string {
  const lines = palette.colors.map(c => {
    const hint = c.hints.length ? ` (CSS vars: ${c.hints.slice(0, 4).join(', ')})` : ''
    return `- ${c.hex} ×${c.count}${hint}`
  })
  const theme = palette.themeColor ? `\nmeta theme-color: ${palette.themeColor}` : ''
  return `Palette extracted directly from the site's own CSS (ground truth — exact hex codes with usage counts; CSS variable names shown where the site itself labels a color's role):\n${lines.join('\n')}${theme}`
}
