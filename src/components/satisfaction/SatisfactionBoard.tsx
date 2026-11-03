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
  countedTopics,
  satisfactionBand,
  satisfactionScore,
  topicWeights,
  type SatisfactionBand,
  type SatisfactionGrades,
  type SatisfactionReview,
  type SatisfactionTopic,
} from '@/lib/satisfaction'

export interface SatisfactionClient {
  brandId: string
  name: string
  isActive: boolean
  /** The client's current review; null = never rated or tagged. */
  review: SatisfactionReview | null
  /** Problems the CRM already sees: delays, late offers, weak results. */
  signals: string[]
}

type Filter = 'all' | 'due' | 'unrated' | 'at_risk' | 'new' | 'churned'
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

const pct = (w: number) => `${Math.round(w * 100)}%`

// Saving calls a server action that revalidates /satisfaction, so the page's
// fresh data arrives as new props: no local copy of the list to keep in sync.
export default function SatisfactionBoard({ clients, today }: { clients: SatisfactionClient[]; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('score_asc')

  const scored = clients.filter(c => c.review?.score != null)
  const scores = scored.map(c => c.review!.score!)
  const overall = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  // Churned clients are never "due": nobody needs to keep re-grading them.
  const isDue = (c: SatisfactionClient) =>
    !c.review?.is_churned && (c.review?.score == null || daysSince(c.review.updated_at, today) > REVIEW_STALE_DAYS)
  const dueCount = clients.filter(c => c.isActive && isDue(c)).length
  const bandCounts = scores.reduce<Record<SatisfactionBand, number>>(
    (acc, s) => { acc[satisfactionBand(s)]++; return acc },
    { great: 0, good: 0, watch: 0, at_risk: 0 },
  )
  const newCount = clients.filter(c => c.review?.is_new).length
  const churnedCount = clients.filter(c => c.review?.is_churned).length
  const unratedCount = clients.filter(c => c.review?.score == null).length

  // Average of the grades given. A New client's Results grade doesn't count
  // toward its score, so it doesn't count here either.
  const topicAvg = (k: SatisfactionTopic) => {
    const gs = clients
      .map(c => c.review)
      .filter((r): r is SatisfactionReview => !!r && !(k === 'results' && r.is_new))
      .map(r => r[k])
      .filter((g): g is number => typeof g === 'number')
    return gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .filter(c => {
        const r = c.review
        switch (filter) {
          case 'due': return isDue(c)
          case 'unrated': return r?.score == null
          case 'at_risk': return r?.score != null && satisfactionBand(r.score) === 'at_risk'
          case 'new': return !!r?.is_new
          case 'churned': return !!r?.is_churned
          default: return true
        }
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name)
        const sa = a.review?.score ?? null
        const sb = b.review?.score ?? null
        if (sa === null && sb === null) return a.name.localeCompare(b.name)
        if (sa === null) return 1 // unrated last
        if (sb === null) return -1
        return sort === 'score_asc' ? sa - sb : sb - sa
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, query, filter, sort, today])

  const openClient = clients.find(c => c.brandId === openId) ?? null

  const filters: Array<[Filter, string]> = [
    ['all', `All · ${clients.length}`],
    ['due', `Due · ${clients.filter(isDue).length}`],
    ['unrated', `Not rated · ${unratedCount}`],
    ['at_risk', `At risk · ${bandCounts.at_risk}`],
    ['new', `New · ${newCount}`],
    ['churned', `Churned · ${churnedCount}`],
  ]

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
            Average of {scores.length} rated client{scores.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={tile(null)}>
          <div style={tileLabel}>Clients by level</div>
          <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 4, overflow: 'hidden', margin: '10px 0', background: 'var(--surface-2)' }}>
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
            Active clients not rated, or not updated in {REVIEW_STALE_DAYS} days · {newCount} new · {churnedCount} churned
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
                <span>{t.short}</span><span style={{ fontWeight: 500 }}>{pct(t.weight)}</span>
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
        {filters.map(([f, label]) => (
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
        <div style={{ minWidth: 880 }}>
          <div style={{ ...rowGrid, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
            {['Client', 'Satisfaction', ...SATISFACTION_TOPICS.map(t => t.short), 'Updated'].map((h, i) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: i >= 2 && i <= 6 ? 'center' : 'left' }}>{h}</span>
            ))}
          </div>
          {shown.length === 0 && (
            <p style={{ padding: 'var(--space-5)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No clients match.</p>
          )}
          {shown.map((c, i) => {
            const r = c.review
            const stale = r?.score != null && !r.is_churned && daysSince(r.updated_at, today) > REVIEW_STALE_DAYS
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
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 'var(--text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    {r?.is_new && <Tag kind="new" />}
                    {r?.is_churned && <Tag kind="churned" />}
                    {!c.isActive && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>inactive</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {r?.general_note || (r?.score != null ? 'No general note' : 'Not rated yet · click to rate')}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {r?.score != null ? (
                    <>
                      <span style={{ fontWeight: 800, fontSize: 'var(--text-md)', fontVariantNumeric: 'tabular-nums', minWidth: 52 }}>{r.score.toFixed(1)}%</span>
                      <span style={{ flex: 1 }}><ScoreBar score={r.score} height={6} /></span>
                    </>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>—</span>}
                </span>
                {SATISFACTION_TOPICS.map(t => {
                  const g = r?.[t.key] ?? null
                  const notCounted = t.key === 'results' && !!r?.is_new
                  return (
                    <span key={t.key} style={{ display: 'flex', justifyContent: 'center' }}>
                      {notCounted
                        ? <span title="Not counted while the client is New" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{g ? `${g} · ` : ''}OFF</span>
                        : g ? <GradeChip grade={g} title={`${t.label}: ${g} · ${t.scale[g - 1]}`} />
                          : <span style={{ color: 'var(--text-muted)' }}>·</span>}
                    </span>
                  )
                })}
                <span style={{ fontSize: 'var(--text-xs)', color: stale ? 'var(--warning)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {r ? `${fmtDate(r.updated_at)}${stale ? ' · due' : ''}` : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-4)', lineHeight: 1.6 }}>
        How the score works: each topic is graded 1–5 and weighted (Results 35%, Timelines 20%, Quality 20%, Communication 15%, Owner feel 10%).
        The weighted average out of 5 is scaled to {MAX_SATISFACTION}%, so all 5s is the top score of {MAX_SATISFACTION}%, all 4s is 76% and all 3s is 57%.
        While a client is tagged <strong>New</strong>, Results counts for nothing and the other four topics share its weight; remove the tag and the normal weights come back.
        <strong> Churned</strong> is a label only and doesn&apos;t change the score.
      </p>

      {openClient && (
        <ReviewEditor key={openClient.brandId} client={openClient} today={today} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

// --- Editor -------------------------------------------------------------------

type Notes = Record<SatisfactionTopic | 'general', string>

function ReviewEditor({ client, today, onClose }: { client: SatisfactionClient; today: string; onClose: () => void }) {
  const confirm = useConfirm()
  const last = client.review
  const initial = useMemo(() => {
    const grades = {} as Partial<SatisfactionGrades>
    for (const t of SATISFACTION_TOPICS) grades[t.key] = last?.[t.key] ?? null
    const notes: Notes = {
      results: last?.results_note ?? '',
      timelines: last?.timelines_note ?? '',
      quality: last?.quality_note ?? '',
      communication: last?.communication_note ?? '',
      owner_feel: last?.owner_feel_note ?? '',
      general: last?.general_note ?? '',
    }
    return { grades, notes, isNew: last?.is_new ?? false, isChurned: last?.is_churned ?? false }
  }, [last])

  const [grades, setGrades] = useState(initial.grades)
  const [notes, setNotes] = useState(initial.notes)
  const [isNew, setIsNew] = useState(initial.isNew)
  const [isChurned, setIsChurned] = useState(initial.isChurned)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const weights = topicWeights({ isNew })
  const preview = satisfactionScore(grades, { isNew })
  const missing = countedTopics({ isNew }).filter(k => !grades[k])
  const dirty =
    JSON.stringify({ grades, notes, isNew, isChurned }) !==
    JSON.stringify({ grades: initial.grades, notes: initial.notes, isNew: initial.isNew, isChurned: initial.isChurned })

  async function requestClose() {
    if (dirty && !pending) {
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
    startTransition(async () => {
      const res = await saveSatisfactionReview({ brandId: client.brandId, grades, notes, isNew, isChurned })
      if (!res.ok) { setError(res.message); return }
      onClose()
    })
  }

  const missingLabels = missing.map(k => SATISFACTION_TOPICS.find(t => t.key === k)!.short)

  return (
    <div role="dialog" aria-modal="true" aria-label={`${client.name} satisfaction review`}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={() => void requestClose()} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
      <div style={{
        position: 'relative', width: 'min(560px, 100%)', height: '100%', overflowY: 'auto',
        background: 'var(--surface-1)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 32px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', padding: 'var(--space-4) var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {client.name}
                {isNew && <Tag kind="new" />}
                {isChurned && <Tag kind="churned" />}
              </h2>
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
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
            {preview === null && missing.length > 0
              ? `Grade ${missingLabels.join(', ')} to get a score.`
              : last ? `Last updated ${fmtDate(last.updated_at)} (${daysSince(last.updated_at, today)} days ago)${last.updated_by_email ? ` by ${last.updated_by_email.split('@')[0]}` : ''}` : 'Not rated yet.'}
          </div>
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Tags */}
          <section>
            <h3 style={sectionTitle}>Tags</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <TagToggle kind="new" on={isNew} onChange={setIsNew} hint="Results don't count toward the score" />
              <TagToggle kind="churned" on={isChurned} onChange={setIsChurned} hint="Label only, score unchanged" />
            </div>
          </section>

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
            const g = grades[t.key] ?? null
            const off = weights[t.key] === 0
            return (
              <section key={t.key} style={{ opacity: off ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{t.label}</h3>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {off ? 'Not counted while New' : `${pct(weights[t.key])} of the score`}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{t.question}</p>
                <div role="radiogroup" aria-label={`${t.label} grade`} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const on = g === n
                    return (
                      <button key={n} type="button" role="radio" aria-checked={on} title={t.scale[n - 1]}
                        // Clicking the selected grade clears it.
                        onClick={() => setGrades(gs => ({ ...gs, [t.key]: on ? null : n }))}
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
                  {g ? `${g} · ${t.scale[g - 1]}` : `1 = ${t.scale[0]} · 5 = ${t.scale[4]}`}
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

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            {missing.length > 0 && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginRight: 'auto' }}>
                You can save now; the score appears once {missingLabels.join(', ')} {missing.length === 1 ? 'is' : 'are'} graded.
              </span>
            )}
            <button type="button" className="btn-secondary" onClick={() => void requestClose()}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={pending || !dirty}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Bits -----------------------------------------------------------------------

const TAG_META = {
  new: { label: 'New', color: 'var(--viz-cat-1)' },
  churned: { label: 'Churned', color: 'var(--danger)' },
} as const

function Tag({ kind }: { kind: keyof typeof TAG_META }) {
  const m = TAG_META[kind]
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      padding: '2px 7px', borderRadius: 999, color: 'var(--text-primary)',
      background: `color-mix(in srgb, ${m.color} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${m.color} 50%, transparent)`,
    }}>{m.label}</span>
  )
}

function TagToggle({ kind, on, onChange, hint }: { kind: keyof typeof TAG_META; on: boolean; onChange: (v: boolean) => void; hint: string }) {
  const m = TAG_META[kind]
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
      textAlign: 'left', flex: '1 1 200px',
      background: on ? `color-mix(in srgb, ${m.color} 14%, var(--surface-1))` : 'var(--surface-2)',
      border: `1.5px solid ${on ? m.color : 'var(--border)'}`, color: 'var(--text-primary)',
    }}>
      <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{on ? '✓ ' : ''}{m.label}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{hint}</span>
    </button>
  )
}

function GradeChip({ grade, title }: { grade: number; title?: string }) {
  const c = gradeColor(grade)
  return (
    <span title={title} style={{
      width: 28, height: 28, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
      background: `color-mix(in srgb, ${c} 20%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 55%, transparent)`,
    }}>{grade}</span>
  )
}

function ScoreBar({ score, height }: { score: number | null; height: number }) {
  return (
    <div style={{ height, borderRadius: height / 2, background: 'var(--surface-2)', marginTop: 6 }}>
      {score !== null && (
        <div style={{ width: `${(score / MAX_SATISFACTION) * 100}%`, height: '100%', borderRadius: height / 2, background: BAND_COLOR[satisfactionBand(score)] }} />
      )}
    </div>
  )
}

const rowGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(200px, 1.7fr) minmax(150px, 1.2fr) repeat(5, 72px) 110px',
  gap: 12,
  alignItems: 'center',
}

const tileLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
}

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px',
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
