// Turns the revenue spreadsheet's cell grid into lines the dashboard can use.
//
// Expected layout (the "Revenue Prometheus" sheet, 2026-11):
//
//   Month Projection |         |            |      | =SUM(..) | ... | 200000 | 250000
//   Client           | Service | Start Date | Fee  | 05       | ... | 11     | 12
//   Noble            | MM      | 2026-05-28 | 2000 | 2000     | ... | 2000   | 2000
//
// The header row is found by its "Client" cell, so rows above it can move.
// Month columns are any header cell that reads as a month: 5, "05", "May",
// "2026-05". The sheet's month headers carry no year, so the caller passes the
// year of the first month column and the year rolls over when the month
// number goes back down (… 11, 12, 01 …).
//
// Pure — no Supabase, no `new Date()`.

import { excelSerialToIso, type SheetCell, type SheetGrid } from './xlsx'

export interface ParsedLine {
  rowNumber: number
  clientName: string
  service: string
  startDate: string | null
  feeCents: number | null
  /** month key ('YYYY-MM') → cents. Months with no revenue are absent. */
  months: Record<string, number>
}

export interface ParsedSheet {
  months: string[]
  /** Typed targets only — a SUM formula in the targets row is skipped. */
  targets: Record<string, number>
  lines: ParsedLine[]
  warnings: string[]
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const text = (c: SheetCell | undefined): string =>
  c?.value === null || c?.value === undefined ? '' : String(c.value).trim()

// Header cell → month number 1-12, plus an explicit year when the header has one.
function readMonthHeader(cell: SheetCell | undefined): { month: number; year: number | null } | null {
  if (!cell || cell.value === null) return null
  if (typeof cell.value === 'number') {
    return Number.isInteger(cell.value) && cell.value >= 1 && cell.value <= 12
      ? { month: cell.value, year: null }
      : null
  }
  const s = cell.value.trim().toLowerCase()
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) return { year: Number(m[1]), month: Number(m[2]) }
  m = s.match(/^(\d{1,2})[-/](\d{4})$/)
  if (m) return { year: Number(m[2]), month: Number(m[1]) }
  m = s.match(/^(\d{1,2})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { month: Number(m[1]), year: null }
  m = s.match(/^([a-z]{3})[a-z]*\.?(?:\s*'?(\d{2,4}))?$/)
  if (m) {
    const idx = MONTH_NAMES.indexOf(m[1])
    if (idx >= 0) {
      const y = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : null
      return { month: idx + 1, year: y }
    }
  }
  return null
}

// A money cell → integer cents. Accepts numbers and "$2,000.00"-style text.
export function moneyCents(cell: SheetCell | undefined): number | null {
  if (!cell || cell.value === null) return null
  const n = typeof cell.value === 'number'
    ? cell.value
    : Number(cell.value.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function readDate(cell: SheetCell | undefined): string | null {
  if (!cell || cell.value === null) return null
  if (typeof cell.value === 'number') return excelSerialToIso(cell.value)
  const s = cell.value.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  return null
}

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`

export function parseRevenueSheet(grid: SheetGrid, firstYear: number): ParsedSheet {
  const warnings: string[] = []

  const headerIdx = grid.findIndex(row => row.some(c => text(c).toLowerCase() === 'client'))
  if (headerIdx < 0) {
    throw new Error('Could not find the header row. The sheet needs a column titled "Client".')
  }
  const header = grid[headerIdx]
  const findCol = (test: (s: string) => boolean) => header.findIndex(c => test(text(c).toLowerCase()))

  const clientCol = findCol(s => s === 'client')
  const serviceCol = findCol(s => s === 'service')
  const startCol = findCol(s => s.startsWith('start'))
  const feeCol = findCol(s => s === 'fee' || s.startsWith('fee ') || s === 'retainer')

  // Month columns, left to right, with the year rolling forward on wrap.
  const monthCols: Array<{ col: number; key: string }> = []
  let year = firstYear
  let lastMonth = 0
  header.forEach((cell, col) => {
    if (col === clientCol || col === serviceCol || col === startCol || col === feeCol) return
    const h = readMonthHeader(cell)
    if (!h) return
    if (h.year !== null) year = h.year
    else if (lastMonth && h.month <= lastMonth) year += 1
    lastMonth = h.month
    monthCols.push({ col, key: key(year, h.month) })
  })
  if (monthCols.length === 0) {
    throw new Error('Found the header row, but no month columns (like "05" or "May") next to it.')
  }

  // Targets: a row above the header labelled projection / target / goal.
  const targets: Record<string, number> = {}
  const targetRow = grid
    .slice(0, headerIdx)
    .find(row => /projection|target|goal/i.test(text(row.find(c => text(c) !== ''))))
  if (targetRow) {
    for (const { col, key: k } of monthCols) {
      const cell = targetRow[col]
      if (!cell || cell.formula) continue
      const cents = moneyCents(cell)
      if (cents && cents > 0) targets[k] = cents
    }
  }

  const lines: ParsedLine[] = []
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    const clientName = text(row[clientCol]).replace(/\s+/g, ' ')
    if (!clientName || /^(sub)?total\b/i.test(clientName)) continue

    const months: Record<string, number> = {}
    for (const { col, key: k } of monthCols) {
      const cents = moneyCents(row[col])
      if (cents === null) {
        if (text(row[col]) !== '') warnings.push(`Row ${r + 1} (${clientName}): "${text(row[col])}" in ${k} is not a number, skipped.`)
        continue
      }
      if (cents > 0) months[k] = cents
    }

    lines.push({
      rowNumber: r + 1,
      clientName,
      service: serviceCol >= 0 ? text(row[serviceCol]).toUpperCase() : '',
      startDate: startCol >= 0 ? readDate(row[startCol]) : null,
      feeCents: feeCol >= 0 ? moneyCents(row[feeCol]) : null,
      months,
    })
  }

  if (lines.length === 0) throw new Error('The sheet has a header row but no client rows under it.')

  return { months: monthCols.map(m => m.key), targets, lines, warnings }
}

// Name normalisation for matching sheet clients to CRM brands. Case, spacing,
// punctuation, "&"/"and", and a leading "The" never decide a match.
export function normalizeClientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the\s+/, '')
    .replace(/\s+/g, '')
}
