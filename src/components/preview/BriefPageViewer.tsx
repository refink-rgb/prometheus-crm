'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  DECK_CAP, deckFull, inDeck,
  type BriefDeck, type BriefPageEntry, type BriefPages, type DeckColumn, type PageLine,
} from '@/lib/brief-cheatsheet'
import type { BriefCopyKind, BriefImage } from '@/lib/project-briefs'
import { DocFrame, keyOwnedElsewhere, miniBtn, miniLink, useBodyScrollLock } from './doc-kit'

// One page of a read brief at a time: the page picture on the left, and on the
// right the lines the read placed on that page, the ones worth putting on an ad
// first. Opened from every page thumbnail, "p. N" chip and "Pages" button in
// the brief panel.
//
// Its position lives in BriefReader, not here: the project page polls
// router.refresh() every 6s while a brief is being read, and a viewer that owned
// its own page number would be fine, but one the panel can open at a page
// (a chip on the card) has to be told where to go.
//
// Also home to the small pieces the card and Full read share (a line, its Copy
// and + Deck buttons, a page thumbnail), so a line looks and behaves the same
// wherever it shows up.

// ── Shared pieces ────────────────────────────────────────────────────────

export type DeckScope = 'card' | 'viewer' | 'full'
export type DeckLine = { column: DeckColumn; text: string }

/** What the panel hands every line: signed URLs, the clipboard, and the copy deck. */
export interface BriefTools {
  /** Storage path → signed URL. A path missing here is a blank thumbnail, not an error. */
  urls: Record<string, string>
  /** Why the picture links could not be signed, or null. Shown where a picture would be. */
  urlErr: string | null
  copied: string | null
  onCopy: (key: string, text: string) => void
  /** The project's deck, plus lines this panel just added and the refresh has not brought back yet. */
  deck: BriefDeck
  /** false on hypercare brands: + Deck is hidden, Copy still works. */
  canDeck: boolean
  deckBusy: boolean
  onAddToDeck: (scope: DeckScope, lines: DeckLine[]) => void
  deckNote: { scope: DeckScope; tone: 'ok' | 'err'; text: string; goToDeck: boolean } | null
  onGoToDeck: () => void
}

export const KIND_TAGS: Record<BriefCopyKind, string> = {
  headline: 'Headline', subheadline: 'Subhead', body: 'Body', cta: 'CTA',
  eyebrow: 'Eyebrow', tagline: 'Tagline', disclaimer: 'Disclaimer', other: 'Other',
}

const COLUMN_NAMES: Record<DeckColumn, string> = {
  ad_headlines: 'headlines', ad_subcopies: 'subheadlines', ad_eyebrows: 'eyebrows',
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' | 'accent' }) {
  const color = tone === 'warn' ? 'var(--urgent-soon)' : tone === 'ok' ? 'var(--success)' : tone === 'accent' ? 'var(--accent)' : 'var(--text-muted)'
  return (
    <span style={{
      display: 'inline-block', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, borderRadius: 4,
      padding: '0 5px', lineHeight: '15px', whiteSpace: 'nowrap', verticalAlign: 'middle',
    }}>{children}</span>
  )
}

export function CopyButton({ tools, copyKey, text, label = 'Copy' }: { tools: BriefTools; copyKey: string; text: string; label?: string }) {
  return (
    <button onClick={() => tools.onCopy(copyKey, text)} style={miniLink}>
      {tools.copied === copyKey ? 'Copied ✓' : label}
    </button>
  )
}

/**
 * "+ Deck" and the states that replace it. A line the file check could not find
 * word-for-word takes a second click, so it is never added by a reflex.
 */
export function DeckButton({ tools, scope, column, text, verified }: {
  tools: BriefTools
  scope: DeckScope
  column: DeckColumn
  text: string
  verified: boolean | null
}) {
  const [confirming, setConfirming] = useState(false)
  if (!tools.canDeck) return null
  if (inDeck(tools.deck, column, text)) {
    return <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--success)', flexShrink: 0 }}>In deck ✓</span>
  }
  if (deckFull(tools.deck, column)) {
    return (
      <button disabled style={{ ...miniLink, color: 'var(--text-muted)', cursor: 'default' }}>
        Deck full ({DECK_CAP[column]} {COLUMN_NAMES[column]})
      </button>
    )
  }
  const unverified = verified === false
  return (
    <button
      disabled={tools.deckBusy}
      onClick={() => {
        if (unverified && !confirming) { setConfirming(true); return }
        setConfirming(false)
        tools.onAddToDeck(scope, [{ column, text }])
      }}
      title={unverified && !confirming ? 'Not found word-for-word in the file. Check the page first.' : undefined}
      style={{
        ...miniLink,
        color: confirming ? 'var(--urgent-soon)' : 'var(--accent)',
        opacity: tools.deckBusy ? 0.5 : 1, cursor: tools.deckBusy ? 'wait' : 'pointer',
      }}
    >
      {confirming ? 'Add anyway?' : '+ Deck'}
    </button>
  )
}

/** The result of the last deck add, shown next to where it was clicked. */
export function DeckNote({ tools, scope }: { tools: BriefTools; scope: DeckScope }) {
  const n = tools.deckNote
  if (!n || n.scope !== scope) return null
  return (
    <div role="status" style={{ fontSize: 11.5, lineHeight: 1.5, color: n.tone === 'err' ? 'var(--danger)' : 'var(--success)', overflowWrap: 'anywhere' }}>
      {n.text}
      {n.goToDeck && <> · <button onClick={tools.onGoToDeck} style={miniLink}>Go to deck ↓</button></>}
    </div>
  )
}

/** A page picture at a fixed size. Plain img: the bucket is private and next/image allows public paths only. */
export function PageThumb({ image, tools, width, height, label, onOpen }: {
  image: BriefImage | null
  tools: BriefTools
  width: number | string
  height?: number
  label: string
  onOpen: (() => void) | null
}) {
  const src = image ? tools.urls[image.thumb] : undefined
  const box: React.CSSProperties = {
    width, height, aspectRatio: height ? undefined : '4 / 5', flexShrink: 0, padding: 0, display: 'block',
    background: 'var(--surface-2)', borderRadius: 5, overflow: 'hidden',
    border: image ? '1px solid var(--border)' : '1px dashed var(--border)',
    cursor: onOpen ? 'pointer' : 'default',
  }
  const img = src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt={label} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
    : null
  if (!onOpen) return <span style={box} aria-hidden={!image}>{img}</span>
  return <button onClick={onOpen} title={`Open ${label}`} aria-label={`Open ${label}`} style={box}>{img}</button>
}

/**
 * One line of the brief, as the viewer's rail and Full read show it. What the
 * line IS decides what can be done with it: a brief heading or an image-slot
 * label is not copy, so it gets no buttons at all.
 */
export function LineItem({ line, tools, scope, clampLong = false }: {
  line: PageLine
  tools: BriefTools
  scope: DeckScope
  /** "All text": body over 30 words shows 3 lines until clicked. */
  clampLong?: boolean
}) {
  const [open, setOpen] = useState(false)
  const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)' }
  const quiet: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }

  if (line.role === 'heading' || line.role === 'note') {
    return (
      <div style={row}>
        <div style={{ ...quiet, flex: 1, minWidth: 0 }}>
          <Tag>{line.role === 'heading' ? 'Brief heading' : 'Note to the team'}</Tag> {line.text}
        </div>
      </div>
    )
  }
  if (line.role === 'image-slot') {
    return <div style={row}><div style={{ ...quiet, flex: 1, minWidth: 0 }}>Image slot: {line.text}</div></div>
  }

  const clamped = clampLong && !open && line.kind === 'body' && line.words > 30
  const strong = line.role === 'ad' && (line.kind === 'headline' || line.kind === 'eyebrow' || line.kind === 'cta')
  return (
    <div style={row}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 2 }}>
          {line.role === 'offer' ? <Tag tone="accent">Offer line · copy only</Tag> : <Tag>{KIND_TAGS[line.kind]}</Tag>}
        </div>
        <div
          onClick={clamped ? () => setOpen(true) : undefined}
          title={clamped ? 'Show all of it' : undefined}
          style={{
            fontSize: strong ? 13.5 : 12.5, fontWeight: strong ? 600 : 400, lineHeight: 1.45,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', cursor: clamped ? 'pointer' : undefined,
            ...(clamped ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
          }}
        >
          {line.text}
        </div>
        {line.verified === false && (
          <div style={{ fontSize: 10.5, color: 'var(--urgent-soon)', marginTop: 2 }}>
            Not in the file word-for-word{line.page !== null ? ` · check p. ${line.page}` : ''}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 1 }}>
        <CopyButton tools={tools} copyKey={`${scope}:line:${line.copyIndex}`} text={line.text} />
        {line.deckColumn && (
          <DeckButton tools={tools} scope={scope} column={line.deckColumn} text={line.text} verified={line.verified} />
        )}
      </div>
    </div>
  )
}

/** "p. 4 of 24", "slide 4 of 12", "picture 3 of 7", or "Brief". */
export function entryPosition(pages: BriefPages, e: BriefPageEntry): string {
  if (pages.layout === 'single') return e.label
  const total = pages.layout === 'pdf' || pages.layout === 'slides'
    ? pages.entries.filter(x => x.page !== null).length
    : pages.entries.length
  return e.page !== null ? `${e.label} of ${total}` : e.label
}

/** Below 900px a 380px rail beside a picture is unusable: the rail goes under it. */
const WIDE = '(min-width: 900px)'
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const readWide = () => window.matchMedia(WIDE).matches
// The viewer only ever renders after a click, so the server value is never shown.
const readWideOnServer = () => true
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, readWideOnServer)
}

// ── The viewer ───────────────────────────────────────────────────────────

export default function BriefPageViewer({ pages, index, onIndex, onClose, tools, fileName, narrow, loadOriginal, onReread }: {
  pages: BriefPages
  /** Entry index; BriefReader clamps it to the list. */
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  tools: BriefTools
  fileName: string
  narrow: boolean
  /** A fresh signed URL for the original file, or null (the error shows in the panel). */
  loadOriginal: () => Promise<{ url: string } | { error: string }>
  /** null while a read is running. */
  onReread: (() => void) | null
}) {
  const entry = pages.entries[index]
  const wide = useWide()
  const closeRef = useRef<HTMLButtonElement>(null)
  const stripRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [adOnly, setAdOnly] = useState(false)
  // Per-page state, stamped with the page it belongs to, so moving to another
  // page drops it without an effect.
  const [picAt, setPicAt] = useState<{ index: number; n: number } | null>(null)
  const [allOpenAt, setAllOpenAt] = useState<number | null>(null)
  const [original, setOriginal] = useState<{ index: number; url: string } | null>(null)
  const [originalState, setOriginalState] = useState<{ index: number; busy: boolean; error: string | null } | null>(null)
  const [loaded, setLoaded] = useState<Record<string, true>>({})

  useBodyScrollLock(true)

  // Focus goes to ✕ on open and back to whatever opened the viewer on close.
  // preventScroll: "Go to deck" closes the viewer and scrolls the page, and
  // focusing the opener must not scroll it back.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])

  const strip = adOnly ? pages.entries.filter(e => e.usableCount > 0) : pages.entries
  // Arrows walk the filmstrip as filtered, unless the page on screen is not in it.
  const walk = strip.some(e => e.index === index) ? strip : pages.entries
  const at = walk.findIndex(e => e.index === index)
  const prev = at > 0 ? walk[at - 1] : null
  const next = at >= 0 && at < walk.length - 1 ? walk[at + 1] : null

  // Esc closes; ← → turn pages. Same guards as ReviewWorkspace's Gallery, plus
  // one more: an expanded original over this viewer takes Escape first.
  // No dep array on purpose: it re-binds every render so it always sees the
  // current page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      if (keyOwnedElsewhere() || document.querySelector('[data-doc-expanded]')) return
      if (e.key === 'Escape') { onClose(); return }
      const to = e.key === 'ArrowRight' ? next : prev
      if (!to) return
      e.preventDefault()
      onIndex(to.index)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The filmstrip follows the page, wherever the page change came from. Keyed
  // on the page's key, not the entry: a refresh mid-read rebuilds every entry.
  const entryKey = entry?.key
  useEffect(() => {
    if (!entryKey) return
    stripRefs.current[entryKey]?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [entryKey, adOnly])

  if (!entry) return null

  const pic = picAt?.index === index ? Math.min(picAt.n, Math.max(0, entry.pictures.length - 1)) : 0
  const picture = entry.pictures[pic] ?? null
  const showOriginal = original?.index === index ? original.url : null
  const opening = originalState?.index === index ? originalState : null
  const isPdfPage = pages.layout === 'pdf' && entry.page !== null
  const pageWord = pages.layout === 'slides' ? 'slide' : 'p.'
  const moreUsable = entry.usableCount - entry.usable.length

  async function openOriginal() {
    if (entry.page === null) return
    const i = index
    setOriginalState({ index: i, busy: true, error: null })
    const r = await loadOriginal()
    if ('url' in r) {
      setOriginal({ index: i, url: r.url })
      setOriginalState(null)
    } else {
      setOriginalState({ index: i, busy: false, error: r.error })
    }
  }

  const caption = pages.layout === 'pdf' ? entry.imagery : picture?.captionFull ?? ''

  // ── Stage ──
  let stageBody: React.ReactNode
  if (showOriginal && entry.page !== null) {
    stageBody = (
      <div style={{ width: '100%', display: 'grid', gap: 8, alignContent: 'start' }}>
        <DocFrame
          url={showOriginal} title={fileName} narrow={narrow} inPage page={entry.page}
          height={wide ? 'calc(100vh - 230px)' : '70vh'}
          onNarrow={() => setOriginal(null)}
        />
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 11.5, color: 'var(--text-muted)' }}>
          <span>If this opened on page 1, scroll to p. {entry.page}.</span>
          <button onClick={() => setOriginal(null)} style={miniLink}>Back to page picture</button>
        </div>
      </div>
    )
  } else if (picture) {
    const thumb = tools.urls[picture.image.thumb]
    const full = tools.urls[picture.image.full]
    const fullReady = !!full && !!loaded[full]
    const fit: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }
    stageBody = (
      // The small signed thumbnail shows at once; the full picture fades in over
      // it when it has loaded.
      <div style={{ position: 'relative', width: '100%', height: wide ? '100%' : 'min(70vh, calc(100vh - 120px))', maxHeight: 'calc(100vh - 120px)' }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" aria-hidden style={{ ...fit, opacity: fullReady ? 0 : 1 }} />
        )}
        {full && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={full} alt={picture.captionFull || entry.label}
            onLoad={() => setLoaded(l => ({ ...l, [full]: true }))}
            style={{ ...fit, opacity: fullReady ? 1 : 0, transition: 'opacity 120ms' }}
          />
        )}
        {!thumb && !full && (
          <div style={{ ...fit, display: 'grid', placeItems: 'center', fontSize: 12, color: tools.urlErr ? 'var(--danger)' : 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
            {tools.urlErr ? `Could not load the picture: ${tools.urlErr}` : 'Loading the picture…'}
          </div>
        )}
      </div>
    )
  } else {
    stageBody = (
      <div style={{ display: 'grid', gap: 10, justifyItems: 'center', textAlign: 'center', padding: 24, fontSize: 13, color: 'var(--text-secondary)' }}>
        <div>
          {pages.layout === 'slides' && entry.page !== null
            ? `No picture on slide ${entry.page}`
            : entry.page !== null ? `No preview for p. ${entry.page}` : 'No picture'}
        </div>
        {isPdfPage && (
          <button onClick={() => void openOriginal()} disabled={!!opening?.busy} style={miniLink}>
            {opening?.busy ? 'Opening…' : `Open p. ${entry.page} in the original`}
          </button>
        )}
        {opening?.error && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{opening.error}</div>}
      </div>
    )
  }

  const stage = (
    <div style={{ position: 'relative', minWidth: 0, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: wide ? '12px 56px' : '8px 44px' }}>
      {stageBody}
      {!showOriginal && (
        <>
          <button onClick={() => prev && onIndex(prev.index)} disabled={!prev} aria-label="Previous page" style={{ ...navBtn, left: 8, opacity: prev ? 1 : 0.3 }}>‹</button>
          <button onClick={() => next && onIndex(next.index)} disabled={!next} aria-label="Next page" style={{ ...navBtn, right: 8, opacity: next ? 1 : 0.3 }}>›</button>
        </>
      )}
      {entry.pictures.length > 1 && !showOriginal && (
        <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
          {entry.pictures.map((p, n) => (
            <button
              key={p.image.n} onClick={() => setPicAt({ index, n })}
              aria-label={`Picture ${n + 1} of ${entry.pictures.length}`} aria-pressed={n === pic}
              style={{ width: 9, height: 9, borderRadius: 999, padding: 0, cursor: 'pointer', border: '1px solid var(--border-strong)', background: n === pic ? 'var(--accent)' : 'var(--surface-2)' }}
            />
          ))}
        </div>
      )}
    </div>
  )

  // ── Rail ──
  const rail = (
    <div style={{
      // max-content rows: once the rail scrolls, auto rows shrink an
      // overflow:hidden item (the one-line summary) to nothing.
      minWidth: 0, display: 'grid', gap: 14, alignContent: 'start', gridAutoRows: 'max-content', padding: '14px 16px 20px',
      ...(wide ? { overflowY: 'auto', borderLeft: '1px solid var(--border)' } : { borderTop: '1px solid var(--border)' }),
    }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{entryPosition(pages, entry)}</div>

      {entry.summary && (
        <div title={entry.summary} style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Tag>AI summary</Tag> {entry.summary}
        </div>
      )}
      {caption && (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{caption}</div>
      )}

      {pages.layout === 'pictures' || pages.layout === 'text' ? (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Word files: text isn&apos;t tied to pictures. Lines are in Full read, by section.
        </div>
      ) : (
        <>
          <DeckNote tools={tools} scope="viewer" />
          {entry.noTextKept && pages.truncated ? (
            <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--urgent-soon)' }}>
              No text kept for this page. The read keeps {pages.truncated.kept} lines
              {pages.truncated.lastPage !== null ? ` and stopped at ${pageWord} ${pages.truncated.lastPage}` : ''}.{' '}
              {onReread
                ? <button onClick={onReread} style={miniLink}>Re-read to fill it in</button>
                : 'Re-read to fill it in.'}
            </div>
          ) : entry.lines.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No text on this {pages.layout === 'slides' ? 'slide' : 'page'}.</div>
          ) : (
            <section>
              <RailHead>Use on an ad ({entry.usableCount})</RailHead>
              {entry.usable.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing on this {pages.layout === 'slides' ? 'slide' : 'page'} fits an ad as written.</div>
                : entry.usable.map(l => <LineItem key={l.copyIndex} line={l} tools={tools} scope="viewer" />)}
              {moreUsable > 0 && (
                <button onClick={() => setAllOpenAt(index)} style={{ ...miniLink, marginTop: 6 }}>+{moreUsable} more</button>
              )}
            </section>
          )}

          {entry.lines.length > 0 && (
            <details
              open={allOpenAt === index}
              onToggle={e => { const open = e.currentTarget.open; setAllOpenAt(o => (open ? index : o === index ? null : o)) }}
            >
              <summary style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                All text on this {pages.layout === 'slides' ? 'slide' : 'page'} ({entry.lines.length})
              </summary>
              <div style={{ marginTop: 6 }}>
                {entry.lines.map(l => <LineItem key={l.copyIndex} line={l} tools={tools} scope="viewer" clampLong />)}
              </div>
            </details>
          )}
        </>
      )}

      {isPdfPage && !showOriginal && picture && (
        <div>
          <button onClick={() => void openOriginal()} disabled={!!opening?.busy} style={miniLink}>
            {opening?.busy ? 'Opening…' : `Open p. ${entry.page} in the original`}
          </button>
          {opening?.error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{opening.error}</div>}
        </div>
      )}
    </div>
  )

  // ── Filmstrip ──
  const filmstrip = wide && pages.entries.length > 1 && (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center' }}>
      <button
        onClick={() => setAdOnly(v => !v)} aria-pressed={adOnly}
        style={{ ...miniLink, color: adOnly ? 'var(--accent)' : 'var(--text-secondary)', width: 92, textAlign: 'left', lineHeight: 1.3 }}
      >
        {adOnly ? '☑' : '☐'} Only pages with ad lines
      </button>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, minWidth: 0, paddingBottom: 2 }}>
        {strip.map(e => {
          const current = e.index === index
          const im = e.pictures[0]?.image
          const src = im ? tools.urls[im.thumb] : undefined
          return (
            <button
              key={e.key}
              ref={el => { stripRefs.current[e.key] = el }}
              onClick={() => onIndex(e.index)}
              aria-current={current ? 'page' : undefined}
              title={e.label}
              style={{
                position: 'relative', flexShrink: 0, width: 52, padding: 0, cursor: 'pointer', background: 'none',
                border: `2px solid ${current ? 'var(--accent)' : 'transparent'}`, borderRadius: 6,
              }}
            >
              <span style={{ display: 'block', width: 48, height: 60, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                )}
              </span>
              <span style={{ display: 'block', fontSize: 9.5, color: current ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: 1 }}>
                {e.page ?? e.label}
              </span>
              {e.usableCount > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, borderRadius: 999, padding: '0 3px',
                  fontSize: 9.5, fontWeight: 700, lineHeight: '15px', color: '#fff', background: 'var(--accent)',
                }}>{e.usableCount}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={`${fileName}: ${entry.label}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 800, background: 'var(--background)', color: 'var(--text-primary)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px 0 16px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </span>
        <button ref={closeRef} onClick={onClose} aria-label="Close pages" style={{ ...miniBtn, color: 'var(--text-primary)' }}>✕</button>
      </div>
      {wide ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gridTemplateRows: 'minmax(0, 1fr)' }}>
          {stage}
          {rail}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {stage}
          {rail}
        </div>
      )}
      {filmstrip}
    </div>,
    document.body,
  )
}

function RailHead({ children }: { children: React.ReactNode }) {
  return (
    <h4 style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
      {children}
    </h4>
  )
}

const navBtn: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 36, height: 56, borderRadius: 8,
  fontSize: 24, lineHeight: 1, cursor: 'pointer', color: 'var(--text-primary)',
  background: 'color-mix(in srgb, var(--surface) 85%, transparent)', border: '1px solid var(--border)',
}
