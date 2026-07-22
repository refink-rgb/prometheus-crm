// The app's operating timezone is US Eastern (America/New_York) — decided in
// PHASE0_DISCOVERY.md. Every date-boundary decision (what day "today" is for
// slip scans, when "the 24th" fires) goes through here; nothing else in the
// codebase may call new Date() for calendar logic.

const EASTERN = 'America/New_York'

// 'YYYY-MM-DD' for the current instant in Eastern time. en-CA locale formats
// as ISO date, which sorts and compares lexicographically.
export function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN }).format(new Date())
}

// 'YYYY-MM-DD' in Eastern time for an arbitrary instant (timestamptz ISO string).
export function easternDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN }).format(new Date(iso))
}

// Day-of-month (1-31) in Eastern time.
export function easternDayOfMonth(): number {
  return Number(easternToday().slice(8, 10))
}

// Whole days from `fromIso` (YYYY-MM-DD) to `toIso` (YYYY-MM-DD). Positive when
// `toIso` is later. DATE-only math, so DST never shifts the result.
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

// First day of the month AFTER the given date, as 'YYYY-MM-01'. The 24th-of-
// month cron generates cards for the following month: run July 24 → August 1.
export function followingMonthStart(iso: string): string {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7)) // 1-12
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  return `${next.y}-${String(next.m).padStart(2, '0')}-01`
}
