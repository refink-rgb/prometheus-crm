// Moment delivery tracker — one row per client, one column per month, showing
// moments shipped against the 2 the retainer buys that cycle.
//
// Read-only and server-rendered on purpose: there is nothing to click, so it
// ships no client JS. Cell detail (which moments, when they landed, whether
// they were late) rides on the native `title` tooltip for the same reason.
//
// All state is derived on the SERVER from Eastern today — a browser in another
// timezone can't disagree with the rest of the page about what's overdue.

import { monthLabel, shortDateLabel } from '@/lib/billing'
import { MOMENTS_PER_CYCLE, type CellState, type DeliveryCell, type DeliverySummary } from '@/lib/delivery'

const CELL_TONE: Record<Exclude<CellState, 'no_cycle'>, { color: string; fill: number }> = {
  met:       { color: 'var(--success)', fill: 12 },
  behind:    { color: 'var(--danger)',  fill: 12 },
  at_risk:   { color: 'var(--warning)', fill: 12 },
  in_flight: { color: 'var(--text-muted)', fill: 0 },
}

const STATE_WORD: Record<CellState, string> = {
  no_cycle:  'no billing cycle this month',
  met:       'quota met',
  behind:    'cycle closed short',
  at_risk:   'not enough moments briefed to hit the quota',
  in_flight: 'in flight',
}

const NAME_COL = 200
const MONTH_COL = 92
const BALANCE_COL = 96

export default function DeliveryTracker({ summary, today }: { summary: DeliverySummary; today: string }) {
  const { rows, monthKeys } = summary
  const gridTemplate = `${NAME_COL}px repeat(${monthKeys.length}, ${MONTH_COL}px) ${BALANCE_COL}px`
  const currentMonth = today.slice(0, 7)

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <h2 style={{
          fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
        }}>
          Moment Delivery
        </h2>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {MOMENTS_PER_CYCLE} moments per billing cycle · a moment counts in the cycle it went live
        </span>
      </div>

      {/* Headline: the one number that answers "am I keeping up?" */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)', marginBottom: 'var(--space-4)',
      }}>
        <TrackerStat
          label="Moments Owed"
          value={String(summary.momentsOwed)}
          sub={summary.momentsOwed > 0
            ? `across ${summary.clientsBehind} client${summary.clientsBehind !== 1 ? 's' : ''}`
            : 'every closed cycle delivered'}
          tone={summary.momentsOwed > 0 ? 'danger' : 'success'}
        />
        <TrackerStat
          label="Clients Behind"
          value={String(summary.clientsBehind)}
          sub={`of ${rows.length} on a retainer`}
          tone={summary.clientsBehind > 0 ? 'warning' : 'success'}
        />
        <TrackerStat
          label={`${monthLabel(currentMonth)} Progress`}
          value={`${summary.deliveredThisMonth} / ${summary.owedThisMonth}`}
          sub="delivered in cycles billed this month"
        />
      </div>

      <div style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)',
        borderRadius: 12, overflowX: 'auto',
      }}>
        <div style={{ minWidth: NAME_COL + monthKeys.length * MONTH_COL + BALANCE_COL }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: gridTemplate,
            padding: 'var(--space-2) var(--space-5)', background: 'var(--surface-raised)',
            borderBottom: '1px solid var(--border)',
          }}>
            <HeaderCell>Client</HeaderCell>
            {monthKeys.map(key => (
              <HeaderCell key={key} align="center" highlight={key === currentMonth}>
                {monthLabel(key).slice(0, 3)}
                <span style={{ opacity: 0.6 }}> {key.slice(2, 4)}</span>
              </HeaderCell>
            ))}
            <HeaderCell align="center">Balance</HeaderCell>
          </div>

          {rows.length === 0 && (
            <div style={{
              padding: 'var(--space-6) var(--space-5)', textAlign: 'center',
              fontSize: 'var(--text-base)', color: 'var(--text-muted)',
            }}>
              No billing cycles in this window — nothing to track yet.
            </div>
          )}

          {rows.map((row, i) => (
            <div key={row.brandId} className="pipeline-row" style={{
              display: 'grid', gridTemplateColumns: gridTemplate,
              padding: 'var(--space-2) var(--space-5)', alignItems: 'center',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{
                fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8,
              }}>
                {row.brandName}
              </span>
              {row.cells.map(cell => <MonthCell key={cell.monthKey} cell={cell} />)}
              <BalanceChip balance={row.balance} delivered={row.deliveredToDate} owed={row.owedToDate} />
            </div>
          ))}
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap',
        marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
      }}>
        <LegendKey color="var(--success)" label="quota met" />
        <LegendKey color="var(--danger)" label="cycle closed short" />
        <LegendKey color="var(--warning)" label="at risk — not enough briefed" />
        <LegendKey color="var(--text-muted)" label="in flight" />
        <span>Balance counts closed cycles only. Hover a cell for the moments in it.</span>
      </div>

      {summary.estimatedInWindow > 0 && (
        <p style={{
          marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
          lineHeight: 1.6, maxWidth: 760,
        }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Dashed cells</strong>
          {` hold ${summary.estimatedInWindow} shipped ${summary.estimatedInWindow === 1 ? 'moment' : 'moments'} with no logged ship date — completed before the pipeline event log started, or archived without a stage change. They're placed on their target date, so the cycle they count toward is inferred, and they are never reported as on-time or late.`}
        </p>
      )}
    </div>
  )
}

function MonthCell({ cell }: { cell: DeliveryCell }) {
  if (cell.state === 'no_cycle') {
    return (
      <span title={STATE_WORD.no_cycle} style={{
        textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
        opacity: 0.35, cursor: 'default',
      }}>
        —
      </span>
    )
  }

  const tone = CELL_TONE[cell.state]
  const lines = [
    `Cycle ${shortDateLabel(cell.cycleStart!)} – ${shortDateLabel(cell.cycleEnd!)} · billed ${shortDateLabel(cell.dueDate!)}`,
    `${cell.delivered}/${cell.owed} delivered — ${STATE_WORD[cell.state]}`,
    ...cell.moments.map(m => {
      const slot = m.slot ? `M${m.slot} · ` : ''
      if (!m.delivered) return `  ○ ${slot}${m.name} — in flight`
      const when = m.deliveredOn ? shortDateLabel(m.deliveredOn) : '?'
      // A target-dated moment has no observed ship date, so it gets neither an
      // on-time nor a late claim — just the fact that the date is inferred.
      if (m.dateSource !== 'event') return `  ◐ ${slot}${m.name} — shipped, no date logged (placed on its ${when} target)`
      return `  ● ${slot}${m.name} — live ${when}${m.late ? ' (late)' : ''}`
    }),
  ]
  if (cell.moments.length === 0) lines.push('  (no moments in this cycle)')
  if (cell.estimated > 0) {
    lines.push(`${cell.estimated} of these ${cell.estimated === 1 ? 'was' : 'were'} placed by target date, not a logged ship date.`)
  }

  return (
    <div
      title={lines.join('\n')}
      style={{
        justifySelf: 'center', minWidth: 60, textAlign: 'center',
        padding: '4px 6px', borderRadius: 8,
        background: tone.fill ? `color-mix(in srgb, ${tone.color} ${tone.fill}%, transparent)` : 'transparent',
        // Dashed = at least one moment in here was placed by its target date
        // rather than a logged ship date, so the cycle it landed in is inferred.
        border: `1px ${cell.estimated > 0 ? 'dashed' : 'solid'} ${tone.fill
          ? `color-mix(in srgb, ${tone.color} 30%, transparent)`
          : 'var(--border)'}`,
        cursor: 'default',
      }}
    >
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: tone.color, lineHeight: 1.2 }}>
        {cell.delivered}<span style={{ opacity: 0.55 }}>/{cell.owed}</span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, letterSpacing: '0.02em' }}>
        {cell.inFlight > 0 && !cell.closed ? `+${cell.inFlight} wip` : shortDateLabel(cell.dueDate!)}
      </div>
    </div>
  )
}

function BalanceChip({ balance, delivered, owed }: { balance: number; delivered: number; owed: number }) {
  const color = balance < 0 ? 'var(--danger)' : balance > 0 ? 'var(--success)' : 'var(--text-muted)'
  const label = balance === 0 ? 'even' : balance > 0 ? `+${balance}` : String(balance)
  return (
    <span
      title={`${delivered} delivered against ${owed} owed across closed cycles`}
      style={{
        justifySelf: 'center', fontSize: 'var(--text-sm)', fontWeight: 700, color,
        cursor: 'default',
      }}
    >
      {label}
    </span>
  )
}

function HeaderCell({
  children,
  align = 'left',
  highlight = false,
}: {
  children: React.ReactNode
  align?: 'left' | 'center'
  highlight?: boolean
}) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: highlight ? 'var(--text-primary)' : 'var(--text-muted)',
      textAlign: align,
    }}>
      {children}
    </span>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 9, height: 9, borderRadius: 3, background: `color-mix(in srgb, ${color} 25%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
      }} />
      {label}
    </span>
  )
}

function TrackerStat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const accentVar =
    tone === 'success' ? 'var(--success)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'danger'  ? 'var(--danger)'  : null
  return (
    <div style={{
      background: accentVar ? `color-mix(in srgb, ${accentVar} 8%, var(--surface-1))` : 'var(--surface-1)',
      border: `1px solid ${accentVar ? `color-mix(in srgb, ${accentVar} 30%, var(--border))` : 'var(--border)'}`,
      borderRadius: 10, padding: 'var(--space-3) var(--space-5)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15,
        color: accentVar ?? 'var(--text-primary)',
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}
