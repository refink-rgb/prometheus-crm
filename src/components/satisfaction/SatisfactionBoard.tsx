'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useConfirm } from '@/components/ConfirmDialog'
import { saveSatisfactionReview } from '@/lib/satisfaction-actions'
import {
  MAX_SATISFACTION,
  REVIEW_STALE_DAYS,
  SATISFACTION_BAND_LABEL,
  SATISFACTION_TOPICS,
  satisfactionBand,
  satisfactionScore,
  type SatisfactionBand,
  type SatisfactionGrades,
  type SatisfactionReview,
  type SatisfactionTopic,
} from '@/lib/satisfaction'

export interface SatisfactionClient {
  brandId: string
  name: string
  isActive: boolean
  /** Newest first. */
  reviews: SatisfactionReview[]
  /** Problems the CRM already sees: delays, late offers, weak results. */
  signals: string[]
}

type Filter = 'all' | 'unrated' | 'due' | 'at_risk'
type Sort = 'score_asc' | 'score_desc' | 'name'

const BAND_COLOR: Record<SatisfactionBand, string> = {
  great: 'var(--success)',
  good: 'var(--viz-cat-1)',
  watch: 'var(--warning)',
  at_risk: 'var(--danger)',
}

const gradeColor = (g: number) => (g >= 4 ? 'var(--success)' : g === 3 ? 'var(--warning)' : 'var(--danger)')

function daysSince(iso: string, today: string): number {
  const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000)
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

// Saving calls a server action that revalidates /satisfaction, so the page's
// fresh data arrives as new props: no local copy of the list to keep in sync.
export default function SatisfactionBoard({ clients, today }: { clients: SatisfactionClient[]; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('score_asc')

  const rated = clients.filter(c => c.reviews.length > 0)
  const current = rated.map(c => c.reviews[0])
  const overall = current.length > 0 ? current.reduce((s, r) => s + r.score, 0) / current.length : null
  const isDue = (c: SatisfactionClient) => c.reviews.length === 0 || daysSince(c.reviews[0].created_at, today) > REVIEW_STALE_DAYS
  const dueCount = clients.filter(c => c.isActive && isDue(c)).length
  const bandCounts = current.reduce<Record<SatisfactionBand, number>>(
    (acc, r) => { acc[satisfactionBand(r.score)]++; return acc },
    { great: 0, good: 0, watch: 0, at_risk: 0 },
  )
  const topicAvg = (k: SatisfactionTopic) => (current.length ? current.reduce((s, r) => s + r[k], 0) / current.length : null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .filter(c =>
        filter === 'all' ? true
          : filter === 'unrated' ? c.reviews.length === 0
            : filter === 'due' ? isDue(c)
              : c.reviews.length > 0 && satisfactionBand(c.reviews[0].score) === 'at_risk')
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name)
        const sa = a.reviews[0]?.score ?? null
        const sb = b.reviews[0]?.score ?? null
        if (sa === null && sb === null) return a.name.localeCompare(b.name)
        if (sa === null) return 1 // unrated last
        if (sb === null) return -1
        return sort === 'score_asc' ? sa - sb : sb - sa
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, query, filter, sort, today])

  const openClient = clients.find(c => c.brandId === openId) ?? null

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <div style={tile(overall !== null ? BAND_COLOR[satisfactionBand(overall)] : null)}>
          <div style={tileLabel}>Total satisfaction</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
              {overall !== null ? `${overall.toFixed(1)}%` : '—'}
            </span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>of {MAX_SATISFACTION}% max</span>
          </div>
          <ScoreBar score={overall} height={8} />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 8 }}>
            Average of {current.length} rated client{current.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={tile(null)}>
          <div style={tileLabel}>Clients by level</div>
          <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 4, overflow: 'hidden', margin: '10px 0 10px', background: 'var(--surface-2)' }}>
            {(Object.keys(bandCounts) as SatisfactionBand[]).map(b => bandCounts[b] > 0 && (
              <div key={b} title={`${SATISFACTION_BAND_LABEL[b]}: ${bandCounts[b]}`} style={{ flex: bandCounts[b], background: BAND_COLOR[b] }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {(Object.keys(bandCounts) as SatisfactionBand[]).map(b => (
              <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: BAND_COLOR[b] }} />
                {SATISFACTION_BAND_LABEL[b]} {bandCounts[b]}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 8 }}>
            Great 80%+ · Good 65%+ · Watch 50%+ · At risk under 50%
          </div>
        </div>
        <div style={tile(dueCount > 0 ? 'var(--warning)' : null)}>
          <div style={tileLabel}>Reviews due</div>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>{dueCount}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4 }}>
            Active clients never rated, or not rated in {REVIEW_STALE_DAYS} days · {rated.length} of {clients.length} rated
          </div>
        </div>
      </div>

      {/* Average grade per topic */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        {SATISFACTION_TOPICS.map(t => {
          const avg = topicAvg(t.key)
          return (
            <div key={t.key} style={{ ...tile(null), padding: 'var(--space-3) var(--space-4)' }}>
              <div style={{ ...tileLabel, display: 'flex', justifyContent: 'space-between' }}>
                <span>{t.short}</span><span style={{ fontWeight: 500 }}>{Math.round(t.weight * 100)}%</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
                {avg !== null ? avg.toFixed(1) : '—'}<span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-muted)' }}> / 5</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-2)', marginTop: 6 }}>
                {avg !== null && <div style={{ width: `${(avg / 5) * 100}%`, height: '100%', borderRadius: 2, background: gradeColor(Math.round(avg)) }} />}
              </div>
            </div>
          )
        })}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <input
          type="search" placeholder="Search clients" value={query} onChange={e => setQuery(e.target.value)}
          aria-label="Search clients" style={{ width: 220, maxWidth: '100%' }}
        />
        {([['all', `All · ${clients.length}`], ['due', `Due · ${clients.filter(isDue).length}`], ['unrated', `Not rated · ${clients.length - rated.length}`], ['at_risk', `At risk · ${bandCounts.at_risk}`]] as Array<[Filter, string]>).map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} style={chip(filter === f)}>{label}</button>
        ))}
        <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort" style={{ marginLeft: 'auto' }}>
          <option value="score_asc">Lowest satisfaction first</option>
          <option value="score_desc">Highest satisfaction first</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {/* Client list */}
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ minWidth: 860 }}>
          <div style={{ ...rowGrid, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
            {['Client', 'Satisfaction', ...SATISFACTION_TOPICS.map(t => t.short), 'Last review'].map((h, i) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: i >= 2 && i <= 6 ? 'center' : 'left' }}>{h}</span>
            ))}
          </div>
          {shown.length === 0 && (
            <p style={{ padding: 'var(--space-5)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No clients match.</p>
          )}
          {shown.map((c, i) => {
            const r = c.reviews[0] ?? null
            const prev = c.reviews[1] ?? null
            const delta = r && prev ? r.score - prev.score : null
            const stale = r ? daysSince(r.created_at, today) > REVIEW_STALE_DAYS : false
            return (
              <button
                key={c.brandId}
                type="button"
                onClick={() => setOpenId(c.brandId)}
                className="pipeline-row"
                style={{
                  ...rowGrid, width: '100%', textAlign: 'left', padding: '10px 16px', cursor: 'pointer',
                  background: openId === c.brandId ? 'var(--accent-muted)' : 'transparent',
                  border: 'none', borderBottom: i < shown.length - 1 ? '1px solid var(--border)' : 'none',
                  color: 'var(--text-primary)', font: 'inherit',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 'var(--text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}{!c.isActive && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · inactive</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {r?.general_note || (r ? 'No general note' : 'Not rated yet · click to rate')}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {r ? (
                    <>
                      <span style={{ fontWeight: 800, fontSize: 'var(--text-md)', fontVariantNumeric: 'tabular-nums', minWidth: 52 }}>{r.score.toFixed(1)}%</span>
                      <span style={{ flex: 1 }}><ScoreBar score={r.score} height={6} /></span>
                      {delta !== null && Math.abs(delta) >= 0.1 && (
                        <span title={`vs previous review (${prev!.score.toFixed(1)}%)`} style={{ fontSize: 11, fontWeight: 700, color: delta > 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                          {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                        </span>
                      )}
                    </>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>—</span>}
                </span>
                {SATISFACTION_TOPICS.map(t => (
                  <span key={t.key} style={{ display: 'flex', justifyContent: 'center' }}>
                    {r ? <GradeChip grade={r[t.key]} title={`${t.label}: ${r[t.key]} · ${t.scale[r[t.key] - 1]}`} /> : <span style={{ color: 'var(--text-muted)' }}>·</span>}
                  </span>
                ))}
                <span style={{ fontSize: 'var(--text-xs)', color: stale ? 'var(--warning)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {r ? `${fmtDate(r.created_at)}${stale ? ' · due' : ''}` : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-4)', lineHeight: 1.6 }}>
        How the score works: each topic is graded 1–5 and weighted (Results 35%, Timelines 20%, Quality 20%, Communication 15%, Owner feel 10%).
        The weighted average out of 5 is scaled to {MAX_SATISFACTION}%, so all 5s is the top score of {MAX_SATISFACTION}%, all 4s is 76% and all 3s is 57%.
      </p>

      {openClient && (
        <ReviewEditor
          key={openClient.brandId}
          client={openClient}
          today={today}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

// --- Editor -------------------------------------------------------------------

function ReviewEditor({ client, today, onClose }: {
  client: SatisfactionClient
  today: string
  onClose: () => void
}) {
  const confirm = useConfirm()
  const last = client.reviews[0] ?? null
  const initialGrades = useMemo(() => {
    const g = {} as Partial<SatisfactionGrades>
    for (const t of SATISFACTION_TOPICS) g[t.key] = last ? last[t.key] : undefined
    return g
  }, [last])
  const initialNotes = useMemo(() => ({
    results: last?.results_note ?? '',
    timelines: last?.timelines_note ?? '',
    quality: last?.quality_note ?? '',
    communication: last?.communication_note ?? '',
    owner_feel: last?.owner_feel_note ?? '',
    general: last?.general_note ?? '',
  }), [last])

  const [grades, setGrades] = useState<Partial<SatisfactionGrades>>(initialGrades)
  const [notes, setNotes] = useState(initialNotes)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const complete = SATISFACTION_TOPICS.every(t => grades[t.key])
  const preview = complete ? satisfactionScore(grades as SatisfactionGrades) : null
  const dirty = JSON.stringify(grades) !== JSON.stringify(initialGrades) || JSON.stringify(notes) !== JSON.stringify(initialNotes)

  async function requestClose() {
    if (dirty && !saved) {
      const ok = await confirm({ title: 'Discard changes?', message: 'This review has unsaved changes.', confirmLabel: 'Discard', danger: true })
      if (!ok) return
    }
    onClose()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') void requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function save() {
    setError(null)
    if (!complete) {
      setError('Give every topic a grade from 1 to 5 before saving.')
      return
    }
    startTransition(async () => {
      const res = await saveSatisfactionReview({ brandId: client.brandId, grades: grades as SatisfactionGrades, notes })
      if (!res.ok) { setError(res.message); return }
      setSaved(true)
      onClose()
    })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`${client.name} satisfaction review`}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={() => void requestClose()} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div style={{
        position: 'relative', width: 'min(560px, 100%)', height: '100%', overflowY: 'auto',
        background: 'var(--surface-1)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 32px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', padding: 'var(--space-4) var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{client.name}</h2>
              <Link href={`/brands/${client.brandId}`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Open brand page</Link>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => void requestClose()} aria-label="Close">Close</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--space-3)' }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {preview !== null ? `${preview.toFixed(1)}%` : '—'}
            </span>
            <span style={{ flex: 1 }}><ScoreBar score={preview} height={8} /></span>
            {preview !== null && <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: BAND_COLOR[satisfactionBand(preview)] }}>{SATISFACTION_BAND_LABEL[satisfactionBand(preview)]}</span>}
          </div>
          {last && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
              Last review {fmtDate(last.created_at)} ({daysSince(last.created_at, today)} days ago){last.reviewed_by_email ? ` by ${last.reviewed_by_email.split('@')[0]}` : ''} · {last.score.toFixed(1)}%
            </div>
          )}
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {client.signals.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)', borderRadius: 10, fontSize: 'var(--text-sm)', lineHeight: 1.5,
              background: 'color-mix(in srgb, var(--warning) 8%, var(--surface-1))',
              border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>What the CRM sees</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
                {client.signals.map(s => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}

          {SATISFACTION_TOPICS.map(t => {
            const g = grades[t.key]
            return (
              <section key={t.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{t.label}</h3>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{Math.round(t.weight * 100)}% of the score</span>
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{t.question}</p>
                <div role="radiogroup" aria-label={`${t.label} grade`} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const on = g === n
                    return (
                      <button key={n} type="button" role="radio" aria-checked={on} title={t.scale[n - 1]}
                        onClick={() => setGrades(gs => ({ ...gs, [t.key]: n }))}
                        style={{
                          padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 15,
                          color: 'var(--text-primary)',
                          background: on ? `color-mix(in srgb, ${gradeColor(n)} 22%, var(--surface-1))` : 'var(--surface-2)',
                          border: `1.5px solid ${on ? gradeColor(n) : 'var(--border)'}`,
                        }}>
                        {n}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: g ? 'var(--text-secondary)' : 'var(--text-muted)', margin: '6px 0 8px' }}>
                  {g ? `${g} · ${t.scale[g - 1]}` : '1 = ' + t.scale[0] + ' · 5 = ' + t.scale[4]}
                </div>
                <textarea
                  rows={2} placeholder={`Notes on ${t.label.toLowerCase()}`} value={notes[t.key]}
                  onChange={e => setNotes(ns => ({ ...ns, [t.key]: e.target.value }))}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </section>
            )
          })}

          <section>
            <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>General note</h3>
            <textarea
              rows={4} placeholder="Overall view of this client: context, risks, next steps"
              value={notes.general} onChange={e => setNotes(ns => ({ ...ns, general: e.target.value }))}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </section>

          {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : last ? 'Save new review' : 'Save review'}
            </button>
          </div>

          {client.reviews.length > 0 && (
            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
                History
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {client.reviews.map(r => (
                  <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--text-sm)' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.score.toFixed(1)}%</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        {fmtDate(r.created_at)}{r.reviewed_by_email ? ` · ${r.reviewed_by_email.split('@')[0]}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {SATISFACTION_TOPICS.map(t => (
                        <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                          {t.short} <GradeChip grade={r[t.key]} small />
                        </span>
                      ))}
                    </div>
                    {r.general_note && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{r.general_note}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Bits -----------------------------------------------------------------------

function GradeChip({ grade, title, small }: { grade: number; title?: string; small?: boolean }) {
  const c = gradeColor(grade)
  const size = small ? 20 : 28
  return (
    <span title={title} style={{
      width: size, height: size, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: small ? 11 : 13, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
      background: `color-mix(in srgb, ${c} 20%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 55%, transparent)`,
    }}>{grade}</span>
  )
}

function ScoreBar({ score, height }: { score: number | null; height: number }) {
  return (
    <div style={{ height, borderRadius: height / 2, background: 'var(--surface-2)', marginTop: 6, position: 'relative' }}>
      {score !== null && (
        <div style={{ width: `${(score / MAX_SATISFACTION) * 100}%`, height: '100%', borderRadius: height / 2, background: BAND_COLOR[satisfactionBand(score)] }} />
      )}
    </div>
  )
}

const rowGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 1.6fr) minmax(170px, 1.3fr) repeat(5, 72px) 120px',
  gap: 12,
  alignItems: 'center',
}

const tileLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
}

function tile(accent: string | null): React.CSSProperties {
  return {
    background: accent ? `color-mix(in srgb, ${accent} 6%, var(--surface-1))` : 'var(--surface-1)',
    border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 28%, var(--border))` : 'var(--border)'}`,
    borderRadius: 12, padding: 'var(--space-4) var(--space-5)', minWidth: 0,
  }
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    background: active ? 'var(--accent-muted)' : 'var(--surface-1)',
    border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border)'}`,
  }
}
