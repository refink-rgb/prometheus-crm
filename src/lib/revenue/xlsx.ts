// Minimal .xlsx reader: the first worksheet as a grid of cells.
//
// An .xlsx file is a zip of XML parts, and jszip is already a dependency, so
// reading one cell grid doesn't justify a spreadsheet library. Only what the
// revenue sheet needs is handled: shared strings, inline strings, numbers,
// booleans, and cached formula results. Styles are ignored, so dates arrive as
// Excel serial numbers — see excelSerialToIso().

import JSZip from 'jszip'

export interface SheetCell {
  /** Cached value: a string, a number, or null for an empty cell. */
  value: string | number | null
  /** True when the cell holds a formula (value is its last computed result). */
  formula: boolean
}

export type SheetGrid = SheetCell[][]

const EMPTY: SheetCell = { value: null, formula: false }

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

// All <t> runs inside one fragment, joined. A rich-text shared string is split
// into several runs; plain text is a single one.
function textRuns(fragment: string): string {
  let out = ''
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1]
  return decodeXml(out)
}

// 'AB12' → 27 (zero-based column index).
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

async function firstSheetPath(zip: JSZip): Promise<string> {
  const workbook = await zip.file('xl/workbook.xml')?.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  const rId = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  if (rId && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0]
      if (tag.includes(`Id="${rId}"`)) {
        const target = tag.match(/Target="([^"]+)"/)?.[1]
        if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      }
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

export async function readFirstSheet(data: ArrayBuffer | Uint8Array): Promise<SheetGrid> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('That file is not a valid .xlsx spreadsheet.')
  }

  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string')
  const shared: string[] = []
  if (sharedXml) {
    for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]))
  }

  const sheetXml = await zip.file(await firstSheetPath(zip))?.async('string')
  if (!sheetXml) throw new Error('The spreadsheet has no readable worksheet.')

  const grid: SheetGrid = []
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? grid.length + 1)
    const cells: SheetCell[] = []
    // Self-closing <c .../> cells are empty and carry nothing worth keeping.
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const body = c[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const col = ref ? columnIndex(ref) : cells.length
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const formula = /<f\b/.test(body)
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]

      let value: string | number | null = null
      if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? null
      else if (type === 'inlineStr') value = textRuns(body)
      else if (type === 'str' || type === 'e') value = raw !== undefined ? decodeXml(raw) : null
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
      else if (raw !== undefined && raw !== '') {
        const n = Number(raw)
        value = Number.isFinite(n) ? n : decodeXml(raw)
      }
      if (typeof value === 'string' && value.trim() === '') value = null

      while (cells.length < col) cells.push(EMPTY)
      cells[col] = { value, formula }
    }
    while (grid.length < rowNumber - 1) grid.push([])
    grid[rowNumber - 1] = cells
  }
  return grid
}

// Excel stores dates as days since 1899-12-30 (the 1900 leap-year bug folded in).
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null
  const ms = Math.round((serial - 25569) * 86_400_000)
  return new Date(ms).toISOString().slice(0, 10)
}
