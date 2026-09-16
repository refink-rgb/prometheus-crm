'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { getProjectBriefImageUrls, getProjectBriefUrl } from '@/lib/actions'
import {
  BRIEF_TYPES, COPY_KINDS, COPY_LABELS, normalizeBriefExtraction, readBriefImages,
  type BriefExtraction, type BriefImage,
} from '@/lib/project-briefs'
import type { ProjectBrief } from '@/lib/types'
import { DocFrame, fmtDate, miniLink } from './doc-kit'

// One brief, read. Mounted only while its row is open, so all state here
// belongs to exactly one brief and dies with the panel.
//
// Everything under "AI-extracted" came from a model. It is a reading aid: it
// never writes into the project's offer, copy deck or products, and the
// original file is one click away at the top.

export default function BriefReader({ brief, projectId, narrow, onMakePreviews }: {
  brief: ProjectBrief
  projectId: string
  narrow: boolean
  /** Null while previews are being made elsewhere on the page. */
  onMakePreviews: (() => void) | null
}) {
  const x = useMemo(() => normalizeBriefExtraction(brief.extraction), [brief.extraction])
  const images = useMemo(() => readBriefImages(brief.images), [brief.images])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [urlErr, setUrlErr] = useState<string | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [frameErr, setFrameErr] = useState<string | null>(null)
  const [allPages, setAllPages] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const spec = BRIEF_TYPES[brief.mime_type]
  const isPdf = brief.mime_type === 'application/pdf'

  // Keyed on the paths, not the array: the page polls router.refresh() while
  // any brief is being read, and a new array every 6s must not re-sign 80 URLs.
  const pathKey = images.map(i => i.thumb).join('|')
  useEffect(() => {
    if (!pathKey) return
    let live = true
    getProjectBriefImageUrls(brief.id, projectId)
      .then(r => {
        if (!live) return
        if (r.ok) { setUrls(r.urls); setUrlErr(null) } else setUrlErr(r.error)
      })
      .catch(() => { if (live) setUrlErr('Could not load the pictures.') })
    return () => { live = false }
  }, [brief.id, projectId, pathKey])

  function toggleOriginal() {
    if (frame) { setFrame(null); return }
    setFrameErr(null)
    startTransition(async () => {
      const r = await getProjectBriefUrl(brief.id, projectId, 'view')
      if (r.ok) setFrame(r.url); else setFrameErr(r.error)
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

  const pageOf = (im: BriefImage) => x?.pages.find(p => p.page === im.page)
  const caption = (im: BriefImage): string =>
    im.source === 'pdf-page'
      ? (pageOf(im)?.imagery || pageOf(im)?.summary || '')
      : (x?.images.find(c => c.id === im.n)?.caption ?? '')
  const where = (im: BriefImage): string =>
    im.source === 'pdf-page' ? `p. ${im.page}` : im.page ? `slide ${im.page}` : `picture ${im.n}`

  // PDFs: pages the AI saw no imagery on are hidden by default. A 30-page brief
  // is mostly text pages, and the pictures are what this grid is for.
  const withImagery = images.filter(im => im.source !== 'pdf-page' || pageOf(im)?.has_imagery !== false)
  const shown = allPages || withImagery.length === 0 ? images : withImagery

  return (
    <div style={{ margin: '10px 0 6px 18px', display: 'grid', gap: 18, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px' }}>
        <span style={{ flex: 1, minWidth: 200, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>AI-extracted</strong>
          {brief.extracted_at ? ` ${fmtDate(brief.extracted_at)}` : ''}. It can misread. Check every word that goes on an ad against the original.
        </span>
        {spec?.inline
          ? <button onClick={toggleOriginal} style={miniLink}>{frame ? '▾ Hide original' : '▸ View original'}</button>
          : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Original opens in {spec?.opensIn ?? 'its app'}. Use Download.</span>}
      </div>
      {frameErr && <div style={errText}>{frameErr}</div>}
      {frame && <div><DocFrame url={frame} title={brief.file_name} narrow={narrow} height={640} /></div>}

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

      {x?.summary && (
        <Section title={x.title || 'Summary'}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: '80ch' }}>{x.summary}</p>
          {x.reading_notes && <p style={{ ...muted, margin: '6px 0 0' }}>{x.reading_notes}</p>}
        </Section>
      )}

      {(images.length > 0 || isPdf) && (
        <Section
          title={images.length ? `Images · ${shown.length}${shown.length < images.length ? ` of ${images.length}` : ''}` : 'Images'}
          action={withImagery.length > 0 && withImagery.length < images.length
            ? <button onClick={() => setAllPages(v => !v)} style={miniLink}>{allPages ? 'Only pages with pictures' : `Show all ${images.length} pages`}</button>
            : null}
        >
          {images.length === 0 ? (
            <div style={muted}>
              {brief.images_status === 'failed' ? `No page previews: ${brief.images_note ?? 'they could not be made.'} ` : 'No page previews yet. '}
              {onMakePreviews && <button onClick={onMakePreviews} style={miniLink}>Make page previews</button>}
            </div>
          ) : (
            <>
              {urlErr && <div style={{ ...errText, marginBottom: 8 }}>{urlErr}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                {shown.map(im => {
                  const cap = caption(im)
                  return (
                    <figure key={im.thumb} style={{ margin: 0, minWidth: 0 }}>
                      <a
                        href={urls[im.full]} target="_blank" rel="noreferrer" title="Open full size"
                        style={{ display: 'block', aspectRatio: '4 / 5', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}
                      >
                        {urls[im.thumb] && (
                          // Plain img: the bucket is private and next/image's remotePatterns allow public paths only.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={urls[im.thumb]} alt={cap || where(im)} loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                        )}
                      </a>
                      <figcaption style={{ fontSize: 11, lineHeight: 1.4, marginTop: 4, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{where(im)}</span>{cap ? ` · ${cap}` : ''}
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
              {brief.images_note && <div style={{ ...muted, marginTop: 8 }}>{brief.images_note}</div>}
              {isPdf && !!brief.page_count && brief.page_count > images.length && (
                <div style={{ ...muted, marginTop: 8 }}>
                  Previews cover the first {images.length} of {brief.page_count} pages. View original for the rest.
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {x && <CopyList x={x} copied={copied} onCopy={copy} />}
      {x && <Details x={x} />}
    </div>
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

function Details({ x }: { x: BriefExtraction }) {
  const o = x.offer
  const hasOffer = !!(o.name || o.mechanic || o.code || o.dates || o.price_points.length || o.conditions.length)
  const hasAudience = !!(x.audience.who || x.audience.pains.length || x.audience.desires.length)
  return (
    <>
      {hasOffer && (
        <Section title="Offer">
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
        <Section title="Angles & tone">
          {x.angles.length > 0 && <KV k="Angles"><Bullets items={x.angles} /></KV>}
          <KV k="Tone" v={x.tone.join(' · ')} />
        </Section>
      )}
      {x.mandatories.length + x.dos.length + x.donts.length > 0 && (
        <Section title="Rules">
          {x.mandatories.length > 0 && <KV k="Must include"><Bullets items={x.mandatories} /></KV>}
          {x.dos.length > 0 && <KV k="Do"><Bullets items={x.dos} /></KV>}
          {x.donts.length > 0 && <KV k="Don't"><Bullets items={x.donts} tone="danger" /></KV>}
        </Section>
      )}
      {x.deliverables.length > 0 && (
        <Section title="Deliverables">
          <Bullets items={x.deliverables.map(d => [d.format, d.sizes, d.quantity, d.notes].filter(Boolean).join(' · '))} />
        </Section>
      )}
      {x.references.length > 0 && (
        <Section title="References">
          {x.references.map((r, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 4, overflowWrap: 'anywhere' }}>
              {r.description}
              {r.location && <span style={{ color: 'var(--text-muted)' }}> · {r.location}</span>}
              {r.url && <> · <a href={r.url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent)' }}>{hostOf(r.url)} ↗</a></>}
            </div>
          ))}
        </Section>
      )}
      {x.gaps.length > 0 && (
        <Section title="Not in the brief">
          <Bullets items={x.gaps} tone="warn" />
        </Section>
      )}
    </>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ minWidth: 0 }}>
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

const hostOf = (u: string): string => {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return 'link' }
}

const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }
const errText: React.CSSProperties = { fontSize: 11, color: 'var(--danger)' }
