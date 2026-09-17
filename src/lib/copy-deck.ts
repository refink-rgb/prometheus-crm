// Adding a read brief's lines to a project's copy deck, worked out with no
// server and no React so the rules can be checked on their own.
//
// addBriefLinesToCopyDeck in actions.ts reads the project fresh, runs these,
// and writes back only the columns that gained a line. It never goes through
// saveProjectCopy, which overwrites all three columns from whatever the browser
// last held.

import { DECK_CAP, type DeckColumn } from './brief-cheatsheet'
import { lineKey, matchKey } from './project-briefs'

export const DECK_COLUMNS: readonly DeckColumn[] = ['ad_headlines', 'ad_subcopies', 'ad_eyebrows']

/** One click adds at most the three picks; the viewer's "+ Deck" adds one. 12 leaves room without letting a script fill a deck. */
export const MAX_DECK_LINES_PER_ADD = 12
const MAX_DECK_LINE_CHARS = 300

export type DeckSkipReason = 'in-deck' | 'deck-full'

export interface DeckLine { column: DeckColumn; text: string }

export interface DeckPlan {
  /** Only the columns that gain a line, each as the whole array to write. */
  columns: Partial<Record<DeckColumn, string[]>>
  added: string[]
  skipped: { text: string; reason: DeckSkipReason }[]
}

/**
 * The browser's lines, checked. They arrive from a client call, so the shape is
 * not trusted: anything wrong refuses the whole batch rather than adding part
 * of it, since a half-added batch reads as success on the card.
 */
export function checkDeckLines(raw: unknown): { ok: true; lines: DeckLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Nothing to add.' }
  if (raw.length > MAX_DECK_LINES_PER_ADD) {
    return { ok: false, error: `Add at most ${MAX_DECK_LINES_PER_ADD} lines at a time.` }
  }
  const lines: DeckLine[] = []
  for (const item of raw) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    if (!DECK_COLUMNS.includes(o.column as DeckColumn)) return { ok: false, error: 'Unknown copy deck column.' }
    const text = typeof o.text === 'string' ? o.text.trim() : ''
    // A line of only punctuation has no match key, so it could never be
    // recognised as already in the deck. It is not copy either.
    if (!text || !matchKey(text)) return { ok: false, error: 'A line to add is empty.' }
    // Refused, never cut: a line stored half-way through a word would look
    // like the brief's own words and go on an ad.
    if (text.length > MAX_DECK_LINE_CHARS) return { ok: false, error: 'That line is too long for the copy deck. Copy it instead.' }
    // One deck entry is one line; the edit form would split or flatten it.
    if (/[\r\n]/.test(text)) return { ok: false, error: 'That line runs over several lines. Copy it instead.' }
    lines.push({ column: o.column as DeckColumn, text })
  }
  return { ok: true, lines }
}

/** A stored deck column as its real lines. The column is JSON, so older saves may hold null, blanks or non-strings. */
export function deckLines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : []
}

/**
 * Which lines go in, in order, and what each changed column becomes.
 *
 * "Already there" is checked before "full", so a line that is in a full deck
 * reports in-deck: the card then shows "In deck ✓" rather than a refusal.
 * Both checks see the lines added earlier in the same batch.
 *
 * A changed column is written without its blanks. The cap counts real lines,
 * as the card's deckFull does, and ProjectEditForm's padArray keeps the first 5
 * (or 3) entries by position, so a blank left in front would push a real line
 * past the cap and that form's next save would drop it. Approvals are keyed by
 * text, not position, so closing the gaps moves no verdict.
 */
export function planDeckAdditions(existing: Record<DeckColumn, unknown>, lines: DeckLine[]): DeckPlan {
  const columns: Partial<Record<DeckColumn, string[]>> = {}
  const added: string[] = []
  const skipped: DeckPlan['skipped'] = []
  for (const { column, text } of lines) {
    const list = columns[column] ?? deckLines(existing[column])
    const k = lineKey(text)
    if (list.some(t => lineKey(t) === k)) { skipped.push({ text, reason: 'in-deck' }); continue }
    if (list.length >= DECK_CAP[column]) { skipped.push({ text, reason: 'deck-full' }); continue }
    columns[column] = [...list, text]
    added.push(text)
  }
  return { columns, added, skipped }
}
