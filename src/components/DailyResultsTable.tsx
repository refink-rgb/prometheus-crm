'use client'

// The full daily table: launch date → last update, one row per day, all eight
// metrics, plus day-over-day deltas.
//
// Client component only for the override editor's open/closed state — the data
// is fully rendered server-side and the form posts to a server action.
//
// Two rules the UI has to make visible:
//   * A FLAGGED row is still a real, stored row. The badge says the numbers
//     disagree with each other, not that the day is fake. Dropping it would
//     have made it indistinguishable from a day the campaign didn't run.
//   * A MANUAL row is locked against the agent. That's the repair path, and
//     the reader needs to know which numbers a human asserted.

import { Fragment, useState } from 'react'
import { overrideDailyRow, releaseDailyRowToAgent } from '@/lib/results-actions'
import SubmitButton from '@/components/SubmitButton'
import {
  dayOverDayPct,
  formatCents,
  formatRoas,
  formatPercent,
  formatCount,
  shortDateLabel,
  NO_VALUE,
  type DailyResult,
} from '@/lib/results'

export default function DailyResultsTable({
  rows,
  trackedCampaignId,
  canEdit,
}: {
  rows: DailyResult[]
  trackedCampaignId: string
  canEdit: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)

  // Newest first — the question is almost always "how did yesterday go".
  const display = [...rows].reverse()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
          Daily breakdown
        </h2>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {rows.length} day{rows.length === 1 ? '' : 's'} · {shortDateLabel(rows[0].stat_date)} – {shortDateLabel(rows[rows.length - 1].stat_date)} · newest first
        </div>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 940 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <Th align="left">Date</Th>
              <Th>Spend</Th>
              <Th>Revenue</Th>
              <Th>Incr. revenue</Th>
              <Th>ROAS</Th>
              <Th>Purchases</Th>
              <Th>CPA</Th>
              <Th>Outbound CTR</Th>
              <Th>LP conv.</Th>
              <Th align="left">Flags</Th>
              {canEdit && <Th align="right"> </Th>}
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => {
              // `display` is newest-first, so the PREVIOUS calendar day is the
              // next element, not the one before it.
              const prev = display[i + 1] ?? null
              const revenueDelta = prev ? dayOverDayPct(r.revenue_cents, prev.revenue_cents) : null
              const isManual = r.source === 'manual'
              const isEditing = editing === r.stat_date

              return (
                <Fragment key={r.stat_date}>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: isManual ? 'color-mix(in srgb, var(--accent) 4%, transparent)' : undefined,
                    }}
                  >
                    <Td align="left">
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{shortDateLabel(r.stat_date)}</span>
                      {isManual && (
                        <span
                          className="badge badge-in_progress"
                          style={{ marginLeft: 6, fontSize: 9 }}
                          title="Manually corrected. The agent will not overwrite this day."
                        >
                          manual
                        </span>
                      )}
                    </Td>
                    <Td>{formatCents(r.spend_cents)}</Td>
                    <Td>
                      {formatCents(r.revenue_cents)}
                      {revenueDelta !== null && (
                        <span style={{
                          marginLeft: 6,
                          fontSize: 10,
                          color: revenueDelta >= 0 ? 'var(--success)' : 'var(--danger)',
                        }}>
                          {revenueDelta >= 0 ? '▲' : '▼'} {Math.abs(revenueDelta).toFixed(0)}%
                        </span>
                      )}
                    </Td>
                    {/* '—' where the account doesn't report the column. Never a
                        zero: a zero is a claim, an em dash is an admission. */}
                    <Td>{formatCents(r.incremental_revenue_cents)}</Td>
                    <Td>{formatRoas(r.roas)}</Td>
                    <Td>{formatCount(r.purchases)}</Td>
                    <Td>{formatCents(r.cpa_cents)}</Td>
                    <Td>{formatPercent(r.unique_outbound_ctr)}</Td>
                    <Td>
                      {formatPercent(r.lp_conversion_rate)}
                      {r.landing_page_views !== null && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 4 }}>
                          ({formatCount(r.landing_page_views)} views)
                        </span>
                      )}
                    </Td>
                    <Td align="left">
                      {r.warnings.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>{NO_VALUE}</span>
                      ) : (
                        <span
                          className={isManual ? 'badge badge-upcoming' : 'badge badge-due'}
                          title={r.warnings.join('\n')}
                          style={{ cursor: 'help' }}
                        >
                          {r.warnings.length === 1 && isManual ? 'corrected' : `${r.warnings.length} flag${r.warnings.length === 1 ? '' : 's'}`}
                        </span>
                      )}
                    </Td>
                    {canEdit && (
                      <Td align="right">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => setEditing(isEditing ? null : r.stat_date)}
                        >
                          {isEditing ? 'Cancel' : 'Correct'}
                        </button>
                      </Td>
                    )}
                  </tr>

                  {r.warnings.length > 0 && (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={canEdit ? 11 : 10} style={{ padding: '0 12px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.warnings.map((w, wi) => (
                          <div key={wi} style={{ lineHeight: 1.5 }}>· {w}</div>
                        ))}
                      </td>
                    </tr>
                  )}

                  {isEditing && canEdit && (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td colSpan={11} style={{ padding: '14px 12px', background: 'var(--surface-2)' }}>
                        <OverrideForm
                          row={r}
                          trackedCampaignId={trackedCampaignId}
                          onDone={() => setEditing(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 'var(--space-3)', lineHeight: 1.6, maxWidth: 720 }}>
        Numbers are pulled daily and re-pulled on a trailing window, because Meta restates
        attribution for days after the fact — a day&apos;s figures can change for up to a week.
        Correcting a day locks it against the agent; use &ldquo;hand back to agent&rdquo; to unlock it.
      </p>
    </div>
  )
}

function OverrideForm({
  row,
  trackedCampaignId,
  onDone,
}: {
  row: DailyResult
  trackedCampaignId: string
  onDone: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <strong>Correcting {shortDateLabel(row.stat_date)}.</strong> Saving marks this day{' '}
        <code style={{ fontFamily: 'monospace' }}>manual</code> — the agent will stop overwriting it on
        future runs. ROAS, CPA, and LP conversion are recalculated from what you enter, so they can&apos;t
        drift out of agreement with the inputs.
      </div>

      {/* The editor closes only AFTER the action resolves — closing on submit
          would hide a thrown validation error behind a collapsed form. */}
      <form action={async (fd: FormData) => { await overrideDailyRow(fd); onDone() }}>
        <input type="hidden" name="tracked_campaign_id" value={trackedCampaignId} />
        <input type="hidden" name="stat_date" value={row.stat_date} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
          <Field label="Spend" name="spend" defaultValue={centsToInput(row.spend_cents)} required />
          <Field label="Revenue" name="revenue" defaultValue={centsToInput(row.revenue_cents)} required />
          <Field label="Purchases" name="purchases" defaultValue={String(row.purchases)} />
          <Field label="LP views" name="landing_page_views" defaultValue={row.landing_page_views === null ? '' : String(row.landing_page_views)} hint="blank = unknown" />
          <Field label="Incr. revenue" name="incremental_revenue" defaultValue={centsToInput(row.incremental_revenue_cents)} hint="blank = not reported" />
          <Field label="Outbound CTR %" name="unique_outbound_ctr" defaultValue={row.unique_outbound_ctr === null ? '' : String(row.unique_outbound_ctr)} hint="percent, e.g. 2.45" />
        </div>

        <div style={{ marginTop: 'var(--space-3)' }}>
          <Field label="Why" name="note" defaultValue="" hint="stored with the row so the correction is explainable later" wide />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
          <SubmitButton className="btn-primary btn-sm" pendingText="Saving…">
            Save correction
          </SubmitButton>
        </div>
      </form>

      {row.source === 'manual' && (
        <form
          action={async () => { await releaseDailyRowToAgent(trackedCampaignId, row.stat_date); onDone() }}
        >
          <SubmitButton className="btn-secondary btn-sm" pendingText="Releasing…">
            Hand back to agent
          </SubmitButton>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Clears the manual lock. The numbers stay until the next run replaces them.
          </div>
        </form>
      )}
    </div>
  )
}

function Field({
  label, name, defaultValue, hint, required, wide,
}: {
  label: string
  name: string
  defaultValue: string
  hint?: string
  required?: boolean
  wide?: boolean
}) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label
        htmlFor={`override-${name}`}
        style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3, display: 'block',
        }}
      >
        {label}
      </label>
      <input
        id={`override-${name}`}
        name={name}
        defaultValue={defaultValue}
        required={required}
        style={{
          width: '100%',
          padding: '6px 9px',
          fontSize: 12,
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-primary)',
        }}
      />
      {hint && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

// Cents → a plain editable decimal. Blank for null, so an empty box keeps
// meaning "unknown" on the way back in.
function centsToInput(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(2)
}

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      padding: '10px 12px',
      textAlign: align,
      fontSize: 10,
      fontWeight: 700,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  )
}

function Td({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{
      padding: '9px 12px',
      textAlign: align,
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </td>
  )
}
