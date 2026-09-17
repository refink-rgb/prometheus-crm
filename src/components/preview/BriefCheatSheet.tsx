'use client'

import { useState } from 'react'
import {
  copyPicksText, picksForDeck, SLOT_LABELS,
  type BriefPages, type CheatSheet, type OfferChip, type SlotLine,
} from '@/lib/brief-cheatsheet'
import { BRIEF_SLOTS, BRIEF_TYPES, type BriefExtraction, type BriefImage, type BriefSlot } from '@/lib/project-briefs'
import type { ProjectBrief } from '@/lib/types'
import { CopyButton, DeckButton, DeckNote, PageThumb, Tag, type BriefTools } from './BriefPageViewer'
import { miniLink } from './doc-kit'

// The Editor cheat sheet: one screen with what a static-ad designer needs out
// of a read brief, in the order they need it. Sell, say, put on the ad, show and
// avoid, ask. Every number and pick comes from src/lib/brief-cheatsheet.ts,
// which the page viewer and the fixture checks run too.
//
// It works on every stored read. Older reads get their ad lines picked by
// rules and say so, with a Re-read one click away.
//
// Nothing here writes anywhere except "+ Deck", which adds the brief's own
// words to the project's copy deck, unapproved.

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// "17 Sep" by hand: en-GB now prints "Sept" in some browsers and "Sep" in
// others. UTC for the same reason as fmtDate.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayMonth = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** The strip above the card: when the AI read it, how far to trust its lines, and the two ways into the file. */
export function BriefStrip({ brief, sheet, pages, frameOpen, onToggleOriginal, onPages }: {
  brief: ProjectBrief
  /** null before the first read finishes. */
  sheet: CheatSheet | null
  pages: BriefPages
  frameOpen: boolean
  onToggleOriginal: () => void
  onPages: () => void
}) {
  const spec = BRIEF_TYPES[brief.mime_type]
  // DOCX, PPTX and TXT have a text layer the server checks lines against. PDFs
  // and images do not, so their lines are only as good as the model's eyes.
  const textFile = brief.mime_type === DOCX || brief.mime_type === PPTX || brief.mime_type === 'text/plain'
  const pagesWord = pages.layout === 'pdf' ? 'Pages' : pages.layout === 'slides' ? 'Slides' : pages.entries.length === 1 ? 'Picture' : 'Pictures'
  const date = brief.extracted_at ? dayMonth(brief.extracted_at) : ''

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', flexWrap: 'wrap', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px' }}>
      <span style={{ flex: 1, minWidth: 220, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {sheet ? (
          <>
            <strong style={{ color: 'var(--text-primary)' }}>AI read{date ? ` · ${date}` : ''}.</strong>{' '}
            {textFile && sheet.linesChecked
              ? 'Lines were checked against the file. Amber = not found word-for-word.'
              : 'Lines are not checked word-for-word. Open the page (p. N) before a line goes on an ad.'}
          </>
        ) : (
          <strong style={{ color: 'var(--text-primary)' }}>The client&apos;s file.</strong>
        )}
      </span>
      {spec?.inline
        ? <button onClick={onToggleOriginal} style={miniLink}>{frameOpen ? '▾ Hide original' : '▸ View original'}</button>
        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Original opens in {spec?.opensIn ?? 'its app'}. Use Download.</span>}
      {pages.entries.length > 0 && (
        <button onClick={onPages} style={miniLink}>{pagesWord} · {pages.entries.length}</button>
      )}
    </div>
  )
}

export default function BriefCheatSheet({ brief, x, sheet, pages, offerChips, tools, hypercare, onOpen, onFullRead, onGoTo, onReread }: {
  brief: ProjectBrief
  x: BriefExtraction
  sheet: CheatSheet
  pages: BriefPages
  offerChips: OfferChip[]
  tools: BriefTools
  /** Hypercare brand: its copy comes from a named person, so + Deck is off. */
  hypercare: { brand: string; contact: string } | null
  /** Opens the page viewer at an entry index. */
  onOpen: (index: number) => void
  /** Opens Full read, then scrolls to the anchor. */
  onFullRead: (anchor: string) => void
  /** Scrolls the project page to a section: creative-offer or creative-copy. */
  onGoTo: (id: string) => void
  /** null while a read is running. */
  onReread: (() => void) | null
}) {
  // The option each slot is cycled to. Browser only, this card only.
  const [chosen, setChosen] = useState<Partial<Record<BriefSlot, number>>>({})
  const [confirmAll, setConfirmAll] = useState(false)

  const hasPreviews = pages.entries.some(e => e.pictures.length > 0)
  const pageWord = pages.layout === 'slides' ? 'slide' : 'p.'
  const pageLabel = (page: number) => `${pageWord} ${page}`

  // Where a line's page opens in the viewer. A single-image brief has one
  // "page", and every line sits on it.
  const entryFor = (page: number | null, image: BriefImage | null): number | null => {
    if (page !== null && pages.pageIndex[page] !== undefined) return pages.pageIndex[page]
    if (image && pages.imageIndex[image.n] !== undefined) return pages.imageIndex[image.n]
    if (pages.layout === 'single' && pages.entries.length) return 0
    return null
  }
  const thumbFor = (image: BriefImage | null): BriefImage | null =>
    image ?? (pages.layout === 'single' ? pages.entries[0]?.pictures[0]?.image ?? null : null)

  const opener = (page: number | null, image: BriefImage | null): (() => void) | null => {
    const i = entryFor(page, image)
    return i === null ? null : () => onOpen(i)
  }

  // Render helpers, called as functions: components declared inside a render
  // are new types every render, and would remount (dropping "Add anyway?").
  function pageChip(page: number | null, image: BriefImage | null) {
    if (page === null) return null
    const open = opener(page, image)
    return open
      ? <button onClick={open} style={chip}>{pageLabel(page)}</button>
      : <span style={{ ...chip, cursor: 'default' }}>{pageLabel(page)}</span>
  }

  /** The page picture beside a line, so the words are always read next to where they sit. */
  function thumb(page: number | null, image: BriefImage | null) {
    if (!hasPreviews) return null
    const im = thumbFor(image)
    if (!im) return <span aria-hidden style={{ width: 56, flexShrink: 0 }} />
    return <PageThumb image={im} tools={tools} width={56} height={70} label={page !== null ? pageLabel(page) : 'the picture'} onOpen={opener(page, im)} />
  }

  // ── 1 SELL ──
  const s = sheet.sell
  const sell = (
    <Row n={1} title="Sell">
      {s.empty ? (
        <div style={{ fontSize: 12.5, color: 'var(--urgent-soon)' }}>No product or price in this brief.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
            {s.product && <span style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{s.product}</span>}
            {s.price?.kind === 'strike' && (
              <span style={{ fontSize: 15 }}>
                <s style={{ color: 'var(--text-muted)' }}>{s.price.was}</s>{' '}
                <strong>{s.price.now}</strong>
              </span>
            )}
            {s.price?.kind === 'chips' && (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.price.chips.map(c => <span key={c} style={priceChip}>{c}</span>)}
                {s.price.more > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{s.price.more} more</span>}
              </span>
            )}
          </div>
          {s.products.length > 0 && (
            <div style={mutedLine}>
              Products: {s.products.join(' · ')}{s.moreProducts > 0 ? ` · +${s.moreProducts} more` : ''}
            </div>
          )}
          {s.conditions.length > 0 && (
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
              {s.conditions.join(' · ')}
              {s.moreConditions > 0 && <> · <button onClick={() => onFullRead('brief-offer')} style={miniLink}>+{s.moreConditions} more</button></>}
            </div>
          )}
          {offerChips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {offerChips.map(c => (
                <span key={c.text} style={offerChipStyle(c.tone)}>
                  {c.text}
                  {c.action === 'go-to-offer' && <> · <button onClick={() => onGoTo('creative-offer')} style={{ ...miniLink, fontSize: 11, color: 'inherit', textDecoration: 'underline' }}>Go to Offer ↑</button></>}
                </span>
              ))}
            </div>
          )}
          {s.offerLine && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 }}>
              {thumb(s.offerLine.page, s.offerLine.image)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={slotLabel}>Offer line · copy only</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.45, overflowWrap: 'anywhere' }}>&ldquo;{s.offerLine.text}&rdquo;</div>
                <div style={actions}>
                  {pageChip(s.offerLine.page, s.offerLine.image)}
                  <CopyButton tools={tools} copyKey="card:offer" text={s.offerLine.text} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Row>
  )

  // ── 2 SAY ──
  const say = sheet.say && (
    <Row n={2} title="Say">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {(sheet.say.source === 'tagline' || sheet.say.verbatim) && thumb(sheet.say.page, sheet.say.image)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            {sheet.say.source === 'angle' && sheet.say.verbatim ? <>&ldquo;{sheet.say.text}&rdquo;</> : sheet.say.text}
            {sheet.say.source === 'angle' && !sheet.say.verbatim && <> <Tag>AI&apos;s wording</Tag></>}
          </div>
          <div style={actions}>
            {(sheet.say.source === 'tagline' || sheet.say.verbatim) && pageChip(sheet.say.page, sheet.say.image)}
            {sheet.say.moreAngles > 0 && (
              <button onClick={() => onFullRead('brief-angles')} style={{ ...miniLink, color: 'var(--text-muted)' }}>
                +{sheet.say.moreAngles} angle{sheet.say.moreAngles === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Row>
  )

  // ── 3 PUT ON THE AD ──
  const put = sheet.put
  // Cycled positions, held inside each slot's current options (a Re-read can
  // shorten the list under a remembered position).
  const at: Partial<Record<BriefSlot, number>> = {}
  for (const slot of BRIEF_SLOTS) {
    const n = put.slots[slot].length
    at[slot] = n ? Math.min(chosen[slot] ?? 0, n - 1) : 0
  }
  const deckPicks = picksForDeck(put, tools.deck, at)
  const unverifiedPicks = deckPicks.filter(p => p.verified === false).length
  const angle = x.angles[0]

  function slotRow(slot: BriefSlot) {
    const options = put.slots[slot]
    const i = at[slot] ?? 0
    const line: SlotLine | undefined = options[i]
    // Cycling disarms "Add anyway?": the confirm was for the picks on screen then.
    const cycle = (d: number) => {
      setConfirmAll(false)
      setChosen(c => ({ ...c, [slot]: (i + d + options.length) % options.length }))
    }
    if (!line) {
      return (
        <div key={slot} style={slotRowStyle}>
          {hasPreviews && <span aria-hidden style={{ width: 56, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={slotLabel}>{SLOT_LABELS[slot]}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              None in the brief
              {(slot === 'headline' || slot === 'subline') && (
                <> · <button onClick={() => onGoTo('creative-copy')} style={{ ...miniLink, fontSize: 12 }}>write one in the Copy deck ↓</button></>
              )}
            </div>
          </div>
        </div>
      )
    }
    return (
      <div key={slot} style={slotRowStyle}>
        {thumb(line.page, line.image)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={slotLabel}>{SLOT_LABELS[slot]}</div>
          <div style={{
            fontSize: slot === 'headline' ? 15 : 13.5, fontWeight: slot === 'headline' ? 600 : slot === 'cta' || slot === 'eyebrow' ? 600 : 400,
            lineHeight: 1.4, overflowWrap: 'anywhere',
          }}>
            {line.text}
          </div>
          {line.verified === false && (
            <div style={{ fontSize: 11, color: 'var(--urgent-soon)', marginTop: 2 }}>
              Not in the file word-for-word · check {line.page !== null ? pageLabel(line.page) : 'the original'}
            </div>
          )}
          {line.sentence && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              One sentence from a longer line{line.page !== null ? ` on ${pageLabel(line.page)}` : ''}
            </div>
          )}
          <div style={actions}>
            {pageChip(line.page, line.image)}
            {options.length > 1 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                <button onClick={() => cycle(-1)} aria-label={`Previous ${slot} option`} style={cycleBtn}>‹</button>
                {i + 1}/{options.length}
                <button onClick={() => cycle(1)} aria-label={`Next ${slot} option`} style={cycleBtn}>›</button>
              </span>
            )}
            <CopyButton tools={tools} copyKey={`card:slot:${slot}:${line.copyIndex}`} text={line.text} />
            {line.deckColumn && (
              <DeckButton key={`${line.deckColumn}:${line.copyIndex}`} tools={tools} scope="card" column={line.deckColumn} text={line.text} verified={line.verified} />
            )}
          </div>
        </div>
      </div>
    )
  }

  const putRow = (
    <Row n={3} title="Put on the ad">
      <div style={{ ...mutedLine, marginBottom: 2 }}>On the image: max 1 eyebrow + 1 headline + 1 short subline.</div>
      <div style={{ ...mutedLine, marginBottom: 6 }}>
        {put.source === 'ai' ? (
          "Picked by AI from the brief's own lines"
        ) : (
          <>
            Picked by rules ·{' '}
            {onReread
              ? <button onClick={onReread} style={{ ...miniLink, fontSize: 11.5 }}>Re-read for AI picks</button>
              : 'Re-read for AI picks'}
            {' '}(up to 4 min, replaces this read)
          </>
        )}
      </div>

      {put.empty ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          No ad lines in this brief.{angle ? <> It gives direction: &ldquo;{angle}&rdquo;.</> : ''}{' '}
          Write lines in the <button onClick={() => onGoTo('creative-copy')} style={{ ...miniLink, fontSize: 12.5 }}>Copy deck ↓</button>
        </div>
      ) : (
        <>
          {BRIEF_SLOTS.map(slotRow)}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <CopyButton tools={tools} copyKey="card:picks" text={copyPicksText(put, at)} label="Copy picks" />
            {tools.canDeck && (deckPicks.length ? (
              <button
                disabled={tools.deckBusy}
                onClick={() => {
                  if (unverifiedPicks && !confirmAll) { setConfirmAll(true); return }
                  setConfirmAll(false)
                  tools.onAddToDeck('card', deckPicks.map(p => ({ column: p.column, text: p.text })))
                }}
                style={{
                  ...miniLink, color: confirmAll ? 'var(--urgent-soon)' : 'var(--accent)',
                  opacity: tools.deckBusy ? 0.5 : 1, cursor: tools.deckBusy ? 'wait' : 'pointer',
                }}
              >
                {confirmAll
                  ? `Add ${deckPicks.length} anyway? ${unverifiedPicks} not found word-for-word`
                  : `Add ${deckPicks.length} to Copy deck`}
              </button>
            ) : (
              <button disabled style={{ ...miniLink, color: 'var(--success)', cursor: 'default' }}>Picks in deck ✓</button>
            ))}
          </div>
        </>
      )}
      {hypercare && (
        <div style={{ ...mutedLine, marginTop: 8 }}>
          Copy for {hypercare.brand} comes from {hypercare.contact}. Copy works; adding to the deck is off.
        </div>
      )}
      <div style={{ marginTop: 6 }}><DeckNote tools={tools} scope="card" /></div>
    </Row>
  )

  // ── 4 SHOW · MUST · NEVER ──
  const { show, must, never } = sheet
  const showRow = (
    <Row n={4} title="Show · Must · Never">
      <div style={{ display: 'grid', gap: 14 }}>
        {show.length > 0 && (
          <div>
            <SubLabel>Show</SubLabel>
            <div style={{ display: 'grid', gap: 8 }}>
              {show.map(item => (
                <div key={item.image.n} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <PageThumb
                    image={item.image} tools={tools} width={64} height={80}
                    label={item.page !== null ? pageLabel(item.page) : 'the picture'}
                    onOpen={opener(item.page, item.image)}
                  />
                  <div title={item.captionFull} style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                    {item.page !== null && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{pageLabel(item.page)} </span>}
                    {item.caption}
                  </div>
                </div>
              ))}
            </div>
            {sheet.showAllPlaceholders && (
              <div style={{ ...mutedLine, marginTop: 6 }}>(mockup boxes, not photos · real assets in Products ↑)</div>
            )}
          </div>
        )}

        <div>
          <SubLabel>
            Must{must.total > must.items.length ? ` · ${must.items.length} of ${must.total}` : ''}
            {must.layoutRules > 0 && (
              <> · <button onClick={() => onFullRead('brief-rules')} style={{ ...miniLink, fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
                {must.layoutRules} page-layout rule{must.layoutRules === 1 ? '' : 's'} in Full read
              </button></>
            )}
          </SubLabel>
          {must.items.length
            ? <Bullets items={must.items} />
            : <div style={mutedLine}>None in the brief</div>}
        </div>

        <div>
          <SubLabel>Never{never.total > never.items.length ? ` · ${never.items.length} of ${never.total}` : ''}</SubLabel>
          {never.items.length
            ? <Bullets items={never.items} color="var(--danger)" />
            : <div style={mutedLine}>None in the brief</div>}
          {/* An AI read files ad donts under ad_rules and can miss some. The
              brief's own donts are never hidden: they are one click away. */}
          {never.source === 'ai' && x.donts.length > 0 && (
            <button onClick={() => onFullRead('brief-rules')} style={{ ...miniLink, fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {x.donts.length} don&apos;t{x.donts.length === 1 ? '' : 's'} in Full read
            </button>
          )}
        </div>
      </div>
    </Row>
  )

  // ── 5 ASK THE CLIENT ──
  const ask = sheet.ask
  const askRow = (
    <Row
      n={5} title="Ask the client"
      aside={ask.copyText ? <CopyButton tools={tools} copyKey="card:questions" text={ask.copyText} label="Copy as questions" /> : null}
    >
      {ask.items.length
        ? <Bullets items={ask.items.map(q => q.text)} color="var(--urgent-soon)" />
        : <div style={mutedLine}>No open questions in the read.</div>}
      {(ask.more > 0 || ask.pageOnly > 0) && (
        <div style={{ ...mutedLine, marginTop: 4 }}>
          {ask.more > 0 && <button onClick={() => onFullRead('brief-gaps')} style={{ ...miniLink, fontSize: 11.5 }}>+{ask.more} more</button>}
          {ask.more > 0 && ask.pageOnly > 0 && ' · '}
          {ask.pageOnly > 0 && `${ask.pageOnly} page-only`}
        </div>
      )}
    </Row>
  )

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{x.title || brief.file_name}</span>
        {sheet.landingPage && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 9px', borderRadius: 999,
            border: '1px solid var(--border-strong)', background: 'var(--surface-2)',
          }}>
            Landing-page brief · ad lines are lifted from page copy
          </span>
        )}
      </div>
      {/* Wide: 1-3 on the left, 4-5 on the right. A phone: one column. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          {sell}
          {say}
          {putRow}
        </div>
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          {showRow}
          {askRow}
        </div>
      </div>
    </div>
  )
}

function Row({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span aria-hidden style={{
          width: 18, height: 18, borderRadius: 999, display: 'inline-grid', placeItems: 'center', flexShrink: 0,
          fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-muted)',
        }}>{n}</span>
        <h4 style={{ margin: 0, flex: 1, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
      {children}
    </div>
  )
}

function Bullets({ items, color }: { items: string[]; color?: string }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {items.map((t, i) => (
        <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 2, color, overflowWrap: 'anywhere' }}>{t}</li>
      ))}
    </ul>
  )
}

function offerChipStyle(tone: OfferChip['tone']): React.CSSProperties {
  const color = tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--urgent-soon)' : 'var(--text-secondary)'
  return {
    fontSize: 11, fontWeight: 600, lineHeight: 1.4, padding: '2px 8px', borderRadius: 999, color,
    background: tone === 'warn' ? 'var(--urgent-soon-bg)' : 'transparent',
    border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
    overflowWrap: 'anywhere',
  }
}

const mutedLine: React.CSSProperties = { fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }
const slotLabel: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 1 }
const slotRowStyle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }
const actions: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', marginTop: 4 }
const chip: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 999, cursor: 'pointer', flexShrink: 0,
  color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
}
const priceChip: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, padding: '1px 8px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)',
}
const cycleBtn: React.CSSProperties = {
  ...miniLink, fontSize: 14, lineHeight: 1, padding: '0 4px', color: 'var(--text-secondary)',
}
