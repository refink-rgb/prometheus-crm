'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addBriefLinesToCopyDeck, getProjectBriefImageUrls, getProjectBriefUrl } from '@/lib/actions'
import {
  BRIEF_IMAGE_URL_TTL_SECONDS, COPY_KINDS, COPY_LABELS, MAX_PDF_PREVIEW_PAGES,
  lineKey, normalizeBriefExtraction, readBriefImages,
  type BriefExtraction, type BriefImage,
} from '@/lib/project-briefs'
import {
  buildBriefPages, buildCheatSheet, offerCheck,
  type BriefDeck, type BriefPages, type DeckColumn,
} from '@/lib/brief-cheatsheet'
import type { ProjectBrief } from '@/lib/types'
import BriefCheatSheet, { BriefStrip } from './BriefCheatSheet'
import BriefPageViewer, {
  CopyButton, DeckNote, LineItem, PageThumb, Tag,
  type BriefTools, type DeckLine, type DeckScope,
} from './BriefPageViewer'
import { DocFrame, miniLink } from './doc-kit'

// One brief, read. Mounted only while its row is open, so all state here
// belongs to exactly one brief and dies with the panel.
//
// Everything under "AI read" came from a model. It is a reading aid: the one
// thing it writes is "+ Deck", which adds the brief's own lines to the
// project's copy deck, unapproved. It never touches the offer or products,
// and every line is one click from the page it came from.
//
// Top to bottom: the strip (trust, original, pages), the cheat sheet, then Full
// read collapsed underneath. The page viewer's position lives here so the
// page's refresh poll does not reset it.

/** A brief with no read yet still has pages: the viewer and the page list work from the previews alone. */
const NO_READ = normalizeBriefExtraction({}) as BriefExtraction

type DeckNoteState = BriefTools['deckNote']

export default function BriefReader({
  brief, projectId, brandId, narrow, onMakePreviews, deck, offerText, hypercareContact, brandName, onReread,
}: {
  brief: ProjectBrief
  projectId: string
  brandId: string
  narrow: boolean
  /** Null while previews are being made elsewhere on the page. */
  onMakePreviews: (() => void) | null
  /** The project's copy deck, for "In deck ✓" and "Deck full". */
  deck: BriefDeck
  /** The project's offer, offer description, price, discount and tiered offer, joined. */
  offerText: string
  /** Hypercare brand: the person its copy comes from. + Deck is off. */
  hypercareContact: string | null
  brandName: string | null
  /** Null while a read is running. */
  onReread: (() => void) | null
}) {
  const router = useRouter()
  const x = useMemo(() => normalizeBriefExtraction(brief.extraction), [brief.extraction])
  const images = useMemo(() => readBriefImages(brief.images), [brief.images])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [urlErr, setUrlErr] = useState<string | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [frameErr, setFrameErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // Entry index into pages.entries, or closed.
  const [viewer, setViewer] = useState<number | null>(null)
  const [fullOpen, setFullOpen] = useState(false)
  // n makes a second click on the same "+N more" scroll again.
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null)
  const [deckBusy, setDeckBusy] = useState(false)
  const [deckNote, setDeckNote] = useState<DeckNoteState>(null)
  const [justAdded, setJustAdded] = useState<{ sig: string; lines: DeckLine[] } | null>(null)
  const [, startTransition] = useTransition()

  const isPdf = brief.mime_type === 'application/pdf'
  const sheet = useMemo(() => (x ? buildCheatSheet(x, images, brief.page_count) : null), [x, images, brief.page_count])
  const pages = useMemo(
    () => buildBriefPages(x ?? NO_READ, images, brief.mime_type, brief.page_count),
    [x, images, brief.mime_type, brief.page_count],
  )
  const offerChips = useMemo(() => (x ? offerCheck(x, offerText) : []), [x, offerText])

  // Keyed on the paths, not the array: the page polls router.refresh() while
  // any brief is being read, and a new array every 6s must not re-sign 80 URLs.
  //
  // Re-signed 10 minutes before the URLs expire. A CRM tab stays open all day,
  // and an expired URL is a blank thumbnail with no error. Checked each minute
  // and when the tab comes back into view, since a sleeping laptop skips timers.
  const pathKey = images.map(i => i.thumb).join('|')
  useEffect(() => {
    if (!pathKey) return
    let live = true
    // Stamped on SUCCESS only: a failed sign (Wi-Fi still reconnecting after
    // sleep) is retried on the next minute tick, not 50 minutes later.
    let signedAt = 0
    let inFlight = false
    const sign = () => {
      inFlight = true
      getProjectBriefImageUrls(brief.id, projectId)
        .then(r => {
          if (!live) return
          if (r.ok) { signedAt = Date.now(); setUrls(r.urls); setUrlErr(null) } else setUrlErr(r.error)
        })
        .catch(() => { if (live) setUrlErr('Could not load the pictures.') })
        .finally(() => { inFlight = false })
    }
    const check = () => {
      if (inFlight || document.visibilityState !== 'visible') return
      if (Date.now() - signedAt > (BRIEF_IMAGE_URL_TTL_SECONDS - 600) * 1000) sign()
    }
    sign()
    const t = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      live = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [brief.id, projectId, pathKey])

  // "+N more" opens Full read and then scrolls: the anchor exists only once
  // Full read has rendered, which is after this state commits.
  useEffect(() => {
    if (!scrollTo) return
    document.getElementById(scrollTo.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollTo])

  // A signed "view" URL, fresh each time. It lasts 15 minutes, and a PDF viewer
  // keeps fetching ranges as it scrolls, so an old one is never handed to a new frame.
  async function loadOriginal(): Promise<{ url: string } | { error: string }> {
    // Caught here: a rejected action rethrown from a transition takes down the page.
    try {
      const r = await getProjectBriefUrl(brief.id, projectId, 'view')
      return r.ok ? { url: r.url } : { error: r.error }
    } catch {
      return { error: 'Could not reach the server. Check the connection, then try again.' }
    }
  }

  function toggleOriginal() {
    if (frame) { setFrame(null); return }
    setFrameErr(null)
    startTransition(async () => {
      const r = await loadOriginal()
      if ('url' in r) setFrame(r.url); else setFrameErr(r.error)
    })
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      // Clipboard blocked. The text on screen is selectable.
    }
  }

  // Lines just added show "In deck ✓" at once. They count only while the deck
  // prop is still the one they were added to: once the refresh brings the real
  // deck back, it is the only truth (a line removed there must not look added).
  const deckSig = JSON.stringify([deck.headlines, deck.subcopies, deck.eyebrows])
  const added = justAdded?.sig === deckSig ? justAdded.lines : []
  const plus = (column: DeckColumn) => added.filter(l => l.column === column).map(l => l.text)
  const liveDeck: BriefDeck = added.length
    ? {
      headlines: [...deck.headlines, ...plus('ad_headlines')],
      subcopies: [...deck.subcopies, ...plus('ad_subcopies')],
      eyebrows: [...deck.eyebrows, ...plus('ad_eyebrows')],
    }
    : deck

  function addToDeck(scope: DeckScope, lines: DeckLine[]) {
    if (deckBusy || !lines.length) return
    const sig = deckSig
    setDeckBusy(true)
    setDeckNote(null)
    // try/catch inside the transition: a rejected server action (Wi-Fi blip)
    // is rethrown from it and replaces the page with Next's exception screen.
    startTransition(async () => {
      try {
        const r = await addBriefLinesToCopyDeck(projectId, brandId, lines)
        if (!r.ok) { setDeckNote({ scope, tone: 'err', text: r.error, goToDeck: false }); return }
        const addedKeys = new Set(r.added.map(lineKey))
        const now = lines.filter(l => addedKeys.has(lineKey(l.text)))
        if (now.length) setJustAdded({ sig, lines: now })
        const inDeckN = r.skipped.filter(k => k.reason === 'in-deck').length
        const fullN = r.skipped.filter(k => k.reason === 'deck-full').length
        const parts = [
          r.added.length && `Added ${r.added.length} line${r.added.length === 1 ? '' : 's'} to the Copy deck, not approved yet`,
          inDeckN && `${inDeckN} already in the deck`,
          fullN && `${fullN} not added: that part of the deck is full`,
        ].filter(Boolean) as string[]
        setDeckNote({
          scope,
          tone: fullN && !r.added.length ? 'err' : 'ok',
          text: parts.join(' · ') || 'Nothing to add.',
          goToDeck: r.added.length > 0,
        })
      } catch {
        setDeckNote({ scope, tone: 'err', text: 'Could not reach the server. Check the connection, then try again.', goToDeck: false })
      } finally {
        setDeckBusy(false)
        router.refresh()
      }
    })
  }

  // Scrolls the project page to a section outside this panel. Closes the
  // viewer first; two frames let it unmount and give the page its scroll back.
  function goTo(id: string) {
    setViewer(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }))
  }

  function openFullRead(anchor?: string) {
    setFullOpen(true)
    if (anchor) setScrollTo(s => ({ id: anchor, n: (s?.n ?? 0) + 1 }))
  }

  const tools: BriefTools = {
    urls, urlErr, copied, onCopy: copy,
    deck: liveDeck, canDeck: !hypercareContact, deckBusy, onAddToDeck: addToDeck, deckNote,
    onGoToDeck: () => goTo('creative-copy'),
  }
  const hasPictures = images.length > 0
  const viewerIndex = viewer !== null && pages.entries.length ? Math.min(viewer, pages.entries.length - 1) : null
  const fullLabel = sheet
    ? [
      `${sheet.fullRead.lines} line${sheet.fullRead.lines === 1 ? '' : 's'}`,
      sheet.fullRead.pages > 0 && `${sheet.fullRead.pages} ${pages.layout === 'slides' ? 'slide' : 'page'}${sheet.fullRead.pages === 1 ? '' : 's'}`,
      sheet.fullRead.rules > 0 && `${sheet.fullRead.rules} rule${sheet.fullRead.rules === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')
    : ''

  return (
    <div style={{ margin: '10px 0 6px 18px', display: 'grid', gap: 18, minWidth: 0 }}>
      <BriefStrip
        brief={brief} sheet={sheet} pages={pages} frameOpen={!!frame}
        onToggleOriginal={toggleOriginal} onPages={() => setViewer(0)}
      />
      {frameErr && <div style={errText}>{frameErr}</div>}
      {frame && (
        <div>
          <DocFrame
            url={frame} title={brief.file_name} narrow={narrow} height={640} inPage
            onNarrow={hasPictures ? () => setViewer(0) : undefined}
          />
        </div>
      )}

      {!x && (
        <div style={muted}>
          {brief.extraction_status === 'reading'
            ? 'The AI is reading this brief. This fills in when it finishes; the page refreshes itself.'
            : brief.extraction_status === 'failed'
              ? 'The AI could not read this file (reason above). The original and any pictures are still here.'
              : 'Not read yet. Click "Read with AI" on the row.'}
        </div>
      )}
      {x && brief.extraction_status === 'reading' && (
        <div style={muted}>Re-reading. Showing the previous read until it finishes.</div>
      )}

      {x && sheet && (
        <BriefCheatSheet
          brief={brief} x={x} sheet={sheet} pages={pages} offerChips={offerChips} tools={tools}
          hypercare={hypercareContact ? { brand: brandName || 'this brand', contact: hypercareContact } : null}
          onOpen={setViewer} onFullRead={openFullRead} onGoTo={goTo} onReread={onReread}
        />
      )}

      {x ? (
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          <div>
            <button
              onClick={() => setFullOpen(v => !v)} aria-expanded={fullOpen}
              style={{
                ...miniLink, color: 'var(--text-secondary)', padding: '7px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface-2)',
              }}
            >
              Full read{fullLabel ? ` · ${fullLabel}` : ''} {fullOpen ? '▾' : '▸'}
            </button>
          </div>
          {fullOpen && (
            <>
              {(x.summary || x.reading_notes) && (
                <Section id="brief-summary" title="Summary" action={<Tag>AI summary, not copy</Tag>}>
                  {x.summary && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: '80ch' }}>{x.summary}</p>}
                  {x.reading_notes && <p style={{ ...muted, margin: '6px 0 0' }}>{x.reading_notes}</p>}
                </Section>
              )}
              <PagesAndCopy
                x={x} read pages={pages} brief={brief} images={images} tools={tools} narrow={narrow}
                urlErr={urlErr} onOpen={setViewer} onMakePreviews={onMakePreviews}
              />
              <Details x={x} tools={tools} />
            </>
          )}
        </div>
      ) : (hasPictures || isPdf) && (
        <PagesAndCopy
          x={NO_READ} read={false} pages={pages} brief={brief} images={images} tools={tools} narrow={narrow}
          urlErr={urlErr} onOpen={setViewer} onMakePreviews={onMakePreviews}
        />
      )}

      {viewerIndex !== null && (
        <BriefPageViewer
          pages={pages} index={viewerIndex} onIndex={setViewer} onClose={() => setViewer(null)}
          tools={tools} fileName={brief.file_name} narrow={narrow} loadOriginal={loadOriginal} onReread={onReread}
        />
      )}
    </div>
  )
}

function pageList(pages: number[]): string {
  const head = pages.slice(0, 6).join(', ')
  const rest = pages.length > 6 ? ` and ${pages.length - 6} more` : ''
  return `${pages.length === 1 ? 'page' : 'pages'} ${head}${rest}`
}

/**
 * Full read's pages: every page (or slide, or picture) with ALL the text the
 * read placed on it, next to its picture. "By kind" is the old copy list.
 * Word and text files have no pages, so their lines are grouped by the
 * location heading the read gave them.
 */
function PagesAndCopy({ x, read, pages, brief, images, tools, narrow, urlErr, onOpen, onMakePreviews }: {
  x: BriefExtraction
  /** false: no read yet, only the previews. */
  read: boolean
  pages: BriefPages
  brief: ProjectBrief
  images: BriefImage[]
  tools: BriefTools
  narrow: boolean
  urlErr: string | null
  onOpen: (index: number) => void
  onMakePreviews: (() => void) | null
}) {
  const bySection = pages.layout === 'pictures' || pages.layout === 'text'
  const [view, setView] = useState<'page' | 'kind'>('page')
  const [filter, setFilter] = useState<'copy' | 'pictures' | 'all'>(() => (read && pages.counts.withCopy > 0 ? 'copy' : 'all'))

  const isPdf = brief.mime_type === 'application/pdf'
  // A page whose upload failed is missing from the middle, not the end, so
  // coverage is worked out page by page.
  const previewable = isPdf && brief.page_count ? Math.min(brief.page_count, MAX_PDF_PREVIEW_PAGES) : 0
  const havePages = new Set(images.map(im => im.page))
  const missing = Array.from({ length: previewable }, (_, i) => i + 1).filter(n => !havePages.has(n))

  const notes = (
    <>
      {isPdf && images.length === 0 && (
        <div style={muted}>
          {brief.images_status === 'failed' ? `No page previews: ${brief.images_note ?? 'they could not be made.'} ` : 'No page previews yet. '}
          {onMakePreviews && <button onClick={onMakePreviews} style={miniLink}>Make page previews</button>}
        </div>
      )}
      {urlErr && <div style={errText}>{urlErr}</div>}
      {images.length > 0 && brief.images_note && <div style={muted}>{brief.images_note}</div>}
      {images.length > 0 && missing.length > 0 && (
        <div style={muted}>
          No preview for {pageList(missing)}.{' '}
          {onMakePreviews && <button onClick={onMakePreviews} style={miniLink}>Make page previews again</button>}
        </div>
      )}
      {isPdf && !!brief.page_count && brief.page_count > MAX_PDF_PREVIEW_PAGES && (
        <div style={muted}>
          Previews cover the first {MAX_PDF_PREVIEW_PAGES} of {brief.page_count} pages. View original for the rest.
        </div>
      )}
    </>
  )

  const shown = pages.entries.filter(e => (filter === 'copy' ? e.lines.length > 0 : filter === 'pictures' ? e.hasImagery : true))
  const segment = (active: boolean): React.CSSProperties => ({
    ...miniLink, fontSize: 11.5, padding: '3px 10px', borderRadius: 999,
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    background: active ? 'var(--surface-2)' : 'transparent',
    border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
  })

  return (
    <Section
      id="brief-pages"
      title={read ? 'Pages & copy' : pages.layout === 'slides' ? 'Slides' : 'Pages'}
      action={read ? (
        <span role="group" aria-label="Show copy" style={{ display: 'inline-flex', gap: 6 }}>
          <button onClick={() => setView('page')} aria-pressed={view === 'page'} style={segment(view === 'page')}>
            {bySection ? 'By section' : pages.layout === 'slides' ? 'By slide' : 'By page'}
          </button>
          <button onClick={() => setView('kind')} aria-pressed={view === 'kind'} style={segment(view === 'kind')}>By kind</button>
        </span>
      ) : null}
    >
      {view === 'kind' && read ? (
        <CopyList x={x} copied={tools.copied} onCopy={tools.onCopy} />
      ) : (
        <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          {notes}
          <DeckNote scope="full" tools={tools} />

          {bySection ? (
            <>
              {pages.entries.length > 0 && (
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                  {pages.entries.map(e => (
                    <figure key={e.key} style={{ margin: 0, width: 96, flexShrink: 0 }}>
                      <PageThumb image={e.pictures[0]?.image ?? null} tools={tools} width={96} label={e.label} onOpen={() => onOpen(e.index)} />
                      <figcaption title={e.pictures[0]?.captionFull} style={captionStyle}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{e.label}</span>
                        {e.pictures[0]?.caption ? ` · ${e.pictures[0].caption}` : ''}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {pages.sections.map(sec => (
                <div key={sec.heading || '\u0000unplaced'}>
                  <div style={groupHead}>{sec.heading || 'Unplaced'} · {sec.lines.length}</div>
                  {sec.lines.map(l => <LineItem key={l.copyIndex} line={l} tools={tools} scope="full" clampLong />)}
                </div>
              ))}
            </>
          ) : (
            <>
              {pages.entries.length > 1 && read && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => setFilter('copy')} aria-pressed={filter === 'copy'} style={segment(filter === 'copy')}>
                    With copy · {pages.counts.withCopy}
                  </button>
                  <button onClick={() => setFilter('pictures')} aria-pressed={filter === 'pictures'} style={segment(filter === 'pictures')}>
                    With pictures · {pages.counts.withPictures}
                  </button>
                  <button onClick={() => setFilter('all')} aria-pressed={filter === 'all'} style={segment(filter === 'all')}>
                    All · {pages.counts.all}
                  </button>
                </div>
              )}
              {shown.map(e => (
                <div
                  key={e.key}
                  style={{
                    display: 'grid', gridTemplateColumns: `${narrow ? 96 : 160}px minmax(0, 1fr)`, gap: 14,
                    padding: '10px 0', borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <PageThumb image={e.pictures[0]?.image ?? null} tools={tools} width="100%" label={e.label} onOpen={() => onOpen(e.index)} />
                    <div title={e.pictures[0]?.captionFull} style={captionStyle}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{e.label}</span>
                      {e.pictures[0]?.caption ? ` · ${e.pictures[0].caption}` : ''}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {e.summary && (
                      <div title={e.summary} style={{ ...muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                        {e.summary}
                      </div>
                    )}
                    {e.lines.map(l => <LineItem key={l.copyIndex} line={l} tools={tools} scope="full" clampLong />)}
                    {read && e.noTextKept && pages.truncated ? (
                      <div style={{ ...muted, color: 'var(--urgent-soon)' }}>
                        No text kept for this page. The read keeps {pages.truncated.kept} lines
                        {pages.truncated.lastPage !== null ? ` and stopped at p. ${pages.truncated.lastPage}` : ''}. Re-read to fill it in.
                      </div>
                    ) : read && e.lines.length === 0 ? (
                      <div style={muted}>No text on this {pages.layout === 'slides' ? 'slide' : 'page'}.</div>
                    ) : null}
                  </div>
                </div>
              ))}
              {pages.unplaced.length > 0 && (
                <div>
                  <div style={groupHead}>Unplaced · {pages.unplaced.length}</div>
                  {pages.unplaced.map(l => <LineItem key={l.copyIndex} line={l} tools={tools} scope="full" clampLong />)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  )
}

function CopyList({ x, copied, onCopy }: { x: BriefExtraction; copied: string | null; onCopy: (key: string, text: string) => void }) {
  const groups = COPY_KINDS
    .map(kind => ({ kind, items: x.copy.filter(c => c.kind === kind) }))
    .filter(g => g.items.length > 0)

  if (!groups.length) {
    return (
      <Section title="Copy">
        <div style={muted}>No ready-to-use copy in this brief{x.angles.length ? '. It gives directions instead (Angles & tone, below).' : '.'}</div>
      </Section>
    )
  }

  const all = groups.map(g => `${COPY_LABELS[g.kind]}\n${g.items.map(i => i.text).join('\n')}`).join('\n\n')
  return (
    <Section
      title={`Copy · ${x.copy.length}`}
      action={<button onClick={() => onCopy('all', all)} style={miniLink}>{copied === 'all' ? 'Copied ✓' : 'Copy all'}</button>}
    >
      {groups.map(g => (
        <div key={g.kind} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 10.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
            <span>{COPY_LABELS[g.kind]} · {g.items.length}</span>
            {g.items.length > 1 && (
              <button onClick={() => onCopy(g.kind, g.items.map(i => i.text).join('\n'))} style={{ ...miniLink, fontSize: 10.5 }}>
                {copied === g.kind ? 'Copied ✓' : 'Copy these'}
              </button>
            )}
          </div>
          {g.items.map((c, i) => {
            const key = `${g.kind}:${i}`
            const strong = g.kind === 'headline' || g.kind === 'cta'
            return (
              <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: strong ? 14 : 13, fontWeight: strong ? 600 : 400, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {c.text}
                  </div>
                  {(c.location || c.verified === false) && (
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.location}
                      {c.verified === false && (
                        <span style={{ color: 'var(--urgent-soon)', marginLeft: c.location ? 8 : 0 }}>
                          Not found word-for-word in the file. Check the original.
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => onCopy(key, c.text)} style={miniLink}>{copied === key ? 'Copied ✓' : 'Copy'}</button>
              </div>
            )
          })}
        </div>
      ))}
    </Section>
  )
}

function Details({ x, tools }: { x: BriefExtraction; tools: BriefTools }) {
  const o = x.offer
  const hasOffer = !!(o.name || o.mechanic || o.code || o.dates || o.price_points.length || o.conditions.length)
  const hasAudience = !!(x.audience.who || x.audience.pains.length || x.audience.desires.length)
  return (
    <>
      {hasOffer && (
        <Section id="brief-offer" title="Offer">
          <KV k="Offer" v={o.name} />
          <KV k="Mechanic" v={o.mechanic} />
          <KV k="Prices" v={o.price_points.join(' · ')} />
          <KV k="Code" v={o.code} />
          <KV k="Dates" v={o.dates} />
          {o.conditions.length > 0 && <KV k="Conditions"><Bullets items={o.conditions} /></KV>}
        </Section>
      )}
      {x.products.length > 0 && (
        <Section title={`Products · ${x.products.length}`}>
          <Bullets items={x.products.map(p => (p.details ? `${p.name} — ${p.details}` : p.name))} />
        </Section>
      )}
      {hasAudience && (
        <Section title="Audience">
          <KV k="Who" v={x.audience.who} />
          {x.audience.pains.length > 0 && <KV k="Pains"><Bullets items={x.audience.pains} /></KV>}
          {x.audience.desires.length > 0 && <KV k="Wants"><Bullets items={x.audience.desires} /></KV>}
        </Section>
      )}
      {(x.angles.length > 0 || x.tone.length > 0) && (
        <Section id="brief-angles" title="Angles & tone">
          {x.angles.length > 0 && <KV k="Angles"><Bullets items={x.angles} /></KV>}
          <KV k="Tone" v={x.tone.join(' · ')} />
        </Section>
      )}
      {x.mandatories.length + x.dos.length + x.donts.length + x.ad_rules.length > 0 && (
        <Section id="brief-rules" title="Rules">
          {x.mandatories.length > 0 && <KV k="Must include"><Bullets items={x.mandatories} /></KV>}
          {x.dos.length > 0 && <KV k="Do"><Bullets items={x.dos} /></KV>}
          {x.donts.length > 0 && <KV k="Don't"><Bullets items={x.donts} tone="danger" /></KV>}
          {x.ad_rules.length > 0 && (
            <KV k="Ad rules (AI)">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {x.ad_rules.map((r, i) => (
                  <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 2, color: r.type === 'never' ? 'var(--danger)' : undefined }}>
                    {r.type === 'never' ? 'Never: ' : 'Must: '}{r.text}
                    {r.location && <span style={{ color: 'var(--text-muted)' }}> · {r.location}</span>}
                  </li>
                ))}
              </ul>
            </KV>
          )}
        </Section>
      )}
      {x.deliverables.length > 0 && (
        <Section title="Deliverables">
          <Bullets items={x.deliverables.map(d => [d.format, d.sizes, d.quantity, d.notes].filter(Boolean).join(' · '))} />
        </Section>
      )}
      {x.references.length > 0 && (
        <Section title="References">
          {/* The link is text to copy, not a link to follow: nothing in the
              brief panel sends the editor off to another site. */}
          {x.references.map((r, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 4, overflowWrap: 'anywhere' }}>
              {r.description}
              {r.location && <span style={{ color: 'var(--text-muted)' }}> · {r.location}</span>}
              {r.url && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--text-secondary)', userSelect: 'all' }}>{r.url}</span>{' '}
                  <CopyButton tools={tools} copyKey={`ref:${i}`} text={r.url} label="Copy link" />
                </>
              )}
            </div>
          ))}
        </Section>
      )}
      {x.gaps.length > 0 && (
        <Section id="brief-gaps" title="Not in the brief">
          <Bullets items={x.gaps} tone="warn" />
        </Section>
      )}
    </>
  )
}

function Section({ id, title, action, children }: { id?: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} style={{ minWidth: 0, scrollMarginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

function KV({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  const body = children ?? v
  if (!body) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 110px) minmax(0, 1fr)', gap: 10, fontSize: 12.5, lineHeight: 1.5, marginBottom: 6 }}>
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{body}</div>
    </div>
  )
}

function Bullets({ items, tone }: { items: string[]; tone?: 'warn' | 'danger' }) {
  const color = tone === 'warn' ? 'var(--urgent-soon)' : tone === 'danger' ? 'var(--danger)' : undefined
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {items.map((t, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 2, color }}>{t}</li>)}
    </ul>
  )
}

const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }
const errText: React.CSSProperties = { fontSize: 11, color: 'var(--danger)' }
const captionStyle: React.CSSProperties = { fontSize: 11, lineHeight: 1.4, marginTop: 4, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }
const groupHead: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--text-secondary)', margin: '8px 0 2px' }
