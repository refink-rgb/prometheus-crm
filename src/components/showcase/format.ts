// Metric formatting for the showcase. A null value is ALWAYS rendered as an
// explicit empty state ("—") — never invented or defaulted to zero.

export const EMPTY = '—'

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return EMPTY
  return n.toLocaleString('en-US')
}

export function fmtUsd(n: number | null | undefined, opts?: { decimals?: number }): string {
  if (n == null) return EMPTY
  const decimals = opts?.decimals ?? 2
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return EMPTY
  return `${n.toFixed(decimals)}%`
}

export function fmtRoas(n: number | null | undefined): string {
  if (n == null) return EMPTY
  return `${n.toFixed(2)}x`
}
