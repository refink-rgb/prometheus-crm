// Moment delivery tracker — what each client has paid for against what they
// have actually received.
//
// The whole table is one arithmetic rule: paid invoices × 2 = moments owed,
// minus moments delivered = the balance. No dates are involved, which is what
// makes it trustworthy — the CRM has no reliable ship date for work completed
// before the event log started, and any month-by-month view forces that
// missing date to matter.
//
// Read-only and server-rendered on purpose: there is nothing to click, so it
// ships no client JS.

import { MOMENTS_PER_INVOICE, type DeliveryRow, type DeliverySummary } from '@/lib/delivery'

const GRID = '1fr 90px 90px 90px 90px 110px'

export default function DeliveryTracker({ summary }: { summary: DeliverySummary }) {
  const { rows } = summary

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
          every paid invoice buys {MOMENTS_PER_INVOICE} moments
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)', marginBottom: 'var(--space-4)',
      }}>
        <TrackerStat
          label="Moments Still Owed"
          value={String(summary.momentsStillOwed)}
          sub={summary.momentsStillOwed > 0
            ? `across ${summary.clientsBehind} client${summary.clientsBehind !== 1 ? 's' : ''}`
            : 'every paid invoice delivered'}
          tone={summary.momentsStillOwed > 0 ? 'danger' : 'success'}
        />
        <TrackerStat
          label="Owed vs Delivered"
          value={`${summary.momentsDelivered} / ${summary.momentsOwed}`}
          sub={`${summary.invoicesPaid} paid invoice${summary.invoicesPaid !== 1 ? 's' : ''} × ${MOMENTS_PER_INVOICE}`}
        />
        <TrackerStat
          label="Clients Behind"
          value={String(summary.clientsBehind)}
          sub={`of ${rows.length} who have paid`}
          tone={summary.clientsBehind > 0 ? 'warning' : 'success'}
        />
      </div>

      <div style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)',
        borderRadius: 12, overflowX: 'auto',
      }}>
        <div style={{ minWidth: 640 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-5)', background: 'var(--surface-raised)',
            borderBottom: '1px solid var(--border)',
          }}>
            <HeaderCell>Client</HeaderCell>
            <HeaderCell align="right" title="Invoices marked paid. Waived and void invoices buy nothing.">
              Paid
            </HeaderCell>
            <HeaderCell align="right" title={`Paid invoices × ${MOMENTS_PER_INVOICE}`}>Owed</HeaderCell>
            <HeaderCell align="right" title="Moments live on both tracks, or archived as complete">
              Delivered
            </HeaderCell>
            <HeaderCell align="right" title="Briefed but not shipped yet">In flight</HeaderCell>
            <HeaderCell align="right">Still owed</HeaderCell>
          </div>

          {rows.length === 0 && (
            <div style={{
              padding: 'var(--space-6) var(--space-5)', textAlign: 'center',
              fontSize: 'var(--text-base)', color: 'var(--text-muted)',
            }}>
              No paid invoices yet — nothing has been bought, so nothing is owed.
            </div>
          )}

          {rows.map((row, i) => (
            <ClientRow key={row.brandId} row={row} last={i === rows.length - 1} />
          ))}
        </div>
      </div>

      <p style={{
        marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        lineHeight: 1.6, maxWidth: 780,
      }}>
        {`Counted over the whole relationship, not per month — a moment that slipped from one month into the next still pays down the same debt. Only invoices marked paid count toward what's owed; scheduled, waived, and void ones buy nothing.`}
      </p>
    </div>
  )
}

function ClientRow({ row, last }: { row: DeliveryRow; last: boolean }) {
  const behind = row.balance > 0
  // Enough briefed work to close the gap if it all ships — a different problem
  // from a gap with nothing behind it.
  const covered = behind && row.momentsInFlight >= row.balance

  return (
    <div className="pipeline-row" style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-5)', alignItems: 'center',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{
        fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8,
      }}>
        {row.brandName}
        {row.invoicesUnpaid > 0 && (
          <span
            title={`${row.invoicesUnpaid} invoice${row.invoicesUnpaid !== 1 ? 's' : ''} due but not paid — not counted as owed until collected`}
            style={{ marginLeft: 6, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--warning)' }}
          >
            +{row.invoicesUnpaid} unpaid
          </span>
        )}
      </span>

      <Num value={row.invoicesPaid} />
      <Num value={row.momentsOwed} />
      <Num value={row.momentsDelivered} />
      <Num value={row.momentsInFlight} muted={row.momentsInFlight === 0} />

      <span
        title={covered
          ? `${row.balance} still owed, and ${row.momentsInFlight} already briefed — enough to close the gap once they ship`
          : behind
            ? `${row.balance} moment${row.balance !== 1 ? 's' : ''} owed with only ${row.momentsInFlight} briefed`
            : row.balance < 0
              ? `${-row.balance} delivered beyond what has been paid for`
              : 'square'}
        style={{
          textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 700, cursor: 'default',
          color: behind ? (covered ? 'var(--warning)' : 'var(--danger)')
            : row.balance < 0 ? 'var(--success)' : 'var(--text-muted)',
        }}
      >
        {row.balance > 0 ? row.balance : row.balance < 0 ? `+${-row.balance}` : '—'}
      </span>
    </div>
  )
}

function Num({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span style={{
      textAlign: 'right', fontSize: 'var(--text-sm)', fontWeight: 600,
      color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
    }}>
      {value}
    </span>
  )
}

function HeaderCell({
  children,
  align = 'left',
  title,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  title?: string
}) {
  return (
    <span title={title} style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: 'var(--text-muted)', textAlign: align, cursor: title ? 'default' : undefined,
    }}>
      {children}
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
