'use client'

// Team roll-up — visible only to canViewCapacity() (the same management-only
// gate the sidebar capacity counters use).
//
// The two numbers worth reading first are the load gap (carried vs. what the
// person said would have been right) and the cause tally. Everything else in
// /insights already tells you where time went; this tells you why.

import { useState } from 'react'
import { CAPACITY_SLIP_CAUSE_LABELS } from '@/lib/types'

export type TeamSubmission = {
  profileId: string
  name: string
  submitted: boolean
  loadRating: number | null
  sustainableMoments: number | null
  momentsCarried: number
  totalHours: number
  atRisk: string | null
  briefsReady: string | null
  briefsReadyDetail: string | null
  blocker: string | null
  improvement: string | null
  rotatingAnswer: string | null
  entries: Array<{ label: string; track: 'lp' | 'creative'; hours: number | null; cause: string | null }>
}

const GRID = '1fr 70px 90px 80px 110px 90px'

export default function TeamRollup({
  submissions,
  weekLabel,
  rotating,
}: {
  submissions: TeamSubmission[]
  weekLabel: string
  rotating: { key: string; question: string }
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const filed = submissions.filter(s => s.submitted)
  const missing = submissions.filter(s => !s.submitted)

  // Cause tally across everyone — the aggregate that makes a fixed picklist
  // worth having. Rows marked on-track aren't stored, so anything here is a
  // real answer.
  const causeTally = new Map<string, number>()
  for (const s of filed) {
    for (const e of s.entries) {
      if (!e.cause || e.cause === 'on_track') continue
      causeTally.set(e.cause, (causeTally.get(e.cause) ?? 0) + 1)
    }
  }
  const topCauses = [...causeTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const totalHours = filed.reduce((sum, s) => sum + s.totalHours, 0)
  const totalMoments = filed.reduce((sum, s) => sum + s.momentsCarried, 0)
  const avgHoursPerMoment = totalMoments > 0 ? totalHours / totalMoments : null

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--space-4)', gap: 'var(--space-3)', flexWrap: 'wrap',
      }}>
        <h2 style={{
          fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
        }}>
          Team — {weekLabel}
        </h2>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {filed.length} of {submissions.length} filed
          {missing.length > 0 && ` · waiting on ${missing.map(m => m.name.split(' ')[0]).join(', ')}`}
        </span>
      </div>

      {filed.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)', textAlign: 'center' }}>
          No reports filed yet this week.
        </div>
      ) : (
        <>
          {/* Week summary */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-3)', marginBottom: 'var(--space-5)',
          }}>
            <Stat label="Focused hours logged" value={fmtHours(totalHours)} />
            <Stat label="Moments worked" value={String(totalMoments)} />
            <Stat
              label="Avg hours / moment"
              value={avgHoursPerMoment == null ? '—' : fmtHours(avgHoursPerMoment)}
              hint="Partial — a moment spans weeks. Only completed moments give a true average."
            />
            <Stat
              label="Over their own limit"
              value={String(filed.filter(s =>
                s.sustainableMoments != null && s.momentsCarried > s.sustainableMoments).length)}
              hint="People who carried more moments than they said was right."
            />
          </div>

          {/* Cause tally */}
          {topCauses.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--space-5)', padding: 'var(--space-5)' }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 'var(--space-3)',
              }}>
                What got in the way — all reports
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {topCauses.map(([cause, count]) => {
                  const pct = (count / Math.max(1, topCauses[0][1])) * 100
                  return (
                    <div key={cause} style={{ display: 'grid', gridTemplateColumns: '1fr 34px', gap: 'var(--space-3)', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', marginBottom: 3 }}>
                          {CAPACITY_SLIP_CAUSE_LABELS[cause] ?? cause}
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-raised)' }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'var(--accent)' }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 'var(--space-4) 0 0', lineHeight: 1.6 }}>
                Cross-read this against Slip Attribution in{' '}
                <a href="/insights" style={{ color: 'var(--accent)' }}>Insights</a> — that shows which
                <em> stage</em> slips happen in, this shows what people say caused them.
              </p>
            </div>
          )}

          {/* Per-person */}
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-5)', borderBottom: '1px solid var(--border)',
              background: 'var(--surface-raised)', borderTopLeftRadius: 12, borderTopRightRadius: 12,
            }}>
              {['Person', 'Load', 'Moments', 'Hours', 'Briefs OK?', ''].map((col, i) => (
                <span key={i} style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                }}>{col}</span>
              ))}
            </div>

            {filed.map((s, i) => {
              const open = openId === s.profileId
              const overLimit = s.sustainableMoments != null && s.momentsCarried > s.sustainableMoments
              return (
                <div key={s.profileId} style={{ borderBottom: i === filed.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <div className="pipeline-row" style={{
                    display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-5)', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.name}
                    </span>
                    <span style={{
                      fontSize: 'var(--text-base)', fontWeight: 700,
                      color: (s.loadRating ?? 0) >= 4 ? 'var(--danger)' : 'var(--text-primary)',
                    }}>
                      {s.loadRating ?? '—'}
                    </span>
                    <span style={{
                      fontSize: 'var(--text-base)', fontWeight: 600,
                      color: overLimit ? 'var(--warning)' : 'var(--text-primary)',
                    }}>
                      {s.momentsCarried}
                      {s.sustainableMoments != null && (
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {s.sustainableMoments}</span>
                      )}
                    </span>
                    <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
                      {fmtHours(s.totalHours)}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: s.briefsReady === 'no' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                      {s.briefsReady ?? '—'}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      style={{ padding: '3px 9px', fontSize: 'var(--text-xs)', justifySelf: 'end' }}
                      onClick={() => setOpenId(open ? null : s.profileId)}
                    >
                      {open ? 'Hide' : 'Read'}
                    </button>
                  </div>

                  {open && (
                    <div style={{
                      padding: 'var(--space-4) var(--space-5) var(--space-5)',
                      background: 'var(--surface-raised)', borderTop: '1px solid var(--border)',
                      display: 'grid', gap: 'var(--space-4)',
                    }}>
                      {s.entries.length > 0 && (
                        <Answer label="Moments">
                          <div style={{ display: 'grid', gap: 4 }}>
                            {s.entries.map((e, k) => (
                              <div key={k} style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
                                <strong style={{ color: 'var(--text-primary)' }}>{e.label}</strong>
                                {' · '}{e.track === 'lp' ? 'LP' : 'Creatives'}
                                {e.hours != null && ` · ${fmtHours(Number(e.hours))}`}
                                {e.cause && e.cause !== 'on_track' && ` · ${CAPACITY_SLIP_CAUSE_LABELS[e.cause] ?? e.cause}`}
                              </div>
                            ))}
                          </div>
                        </Answer>
                      )}
                      <Answer label="At risk next week" value={s.atRisk} />
                      <Answer label="Briefs ready to start" value={s.briefsReadyDetail} />
                      <Answer label="Biggest thing that slowed them down" value={s.blocker} />
                      <Answer label="What they'd change" value={s.improvement} />
                      <Answer label={rotating.question} value={s.rotatingAnswer} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function fmtHours(n: number): string {
  return (n % 1 === 0 ? n : Number(n.toFixed(1))) + 'h'
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 'var(--space-4) var(--space-5)',
    }} title={hint}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 'var(--space-2)',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  )
}

function Answer({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) {
  if (!children && !value) return null
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
      }}>
        {label}
      </div>
      {children ?? (
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {value}
        </p>
      )}
    </div>
  )
}
