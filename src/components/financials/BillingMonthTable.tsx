'use client'

// The payment check-off surface: every invoice due in the selected month, with
// one click to mark it paid.
//
// Two things make this fast enough to run through 18 clients in a sitting:
//   1. The checkbox is OPTIMISTIC (same pattern as StageTracker) — the tick
//      lands on the frame you click, and the server round-trip happens behind
//      it. React reverts it automatically if the action throws.
//   2. The filter bar defaults to "Unpaid", so the list shrinks as you work
//      instead of making you re-scan rows you've already handled.
//
// Row state (`state`) is derived on the SERVER from Eastern today, not here —
// so a browser in another timezone, or a tab left open overnight, can't
// disagree with the rest of the app about whether something is overdue.

import { memo, useCallback, useDeferredValue, useMemo, useOptimistic, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import {
  formatCents,
  parseMoneyToCents,
  shortDateLabel,
  PERIOD_STATE_BADGE,
  PERIOD_STATE_LABEL,
  isCollected,
  isOutstanding,
  type PeriodState,
  type StoredPeriodStatus,
} from '@/lib/billing'
import {
  markPeriodPaid,
  markPeriodUnpaid,
  setPeriodStatus,
  updatePeriodAmount,
} from '@/lib/billing-actions'

export type BillingRow = {
  periodId: string
  brandId: string
  brandName: string
  dueDate: string
  amountCents: number
  status: StoredPeriodStatus
  state: PeriodState
  paidAt: string | null
  paidAmountCents: number | null
  reference: string | null
}

const GRID = '30px 1fr 80px 110px 100px 32px'
type Filter = 'unpaid' | 'all' | 'paid'

// Optimistic overlay: periodId → the status the user just clicked. Applied on
// top of the server rows until the refresh brings the real value back.
type Override = { id: string; status: StoredPeriodStatus }

function applyOverride(row: BillingRow, status: StoredPeriodStatus): BillingRow {
  return {
    ...row,
    status,
    // 'due'/'overdue' vs 'upcoming' can't be recomputed here without today's
    // Eastern date, so an un-settling row falls back to its server state.
    state: status === 'scheduled' ? row.state : (status as PeriodState),
    paidAmountCents: status === 'paid' ? row.amountCents : null,
  }
}

export default function BillingMonthTable({ rows, monthLabel }: { rows: BillingRow[]; monthLabel: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [isPending, startTransition] = useTransition()
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('unpaid')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const [optimisticRows, addOverride] = useOptimistic(
    rows,
    (current: BillingRow[], override: Override) =>
      current.map(r => (r.periodId === override.id ? applyOverride(r, override.status) : r)),
  )

  const run = useCallback((
    id: string,
    optimisticStatus: StoredPeriodStatus | null,
    label: string,
    fn: () => Promise<void>,
  ) => {
    setMenuId(null)
    startTransition(async () => {
      if (optimisticStatus) addOverride({ id, status: optimisticStatus })
      try {
        await fn()
        toast.success(label)
        router.refresh()
      } catch (err) {
        // The optimistic value unwinds on its own when the transition ends.
        toast.error(err instanceof Error ? err.message : 'Something went wrong.')
      }
    })
  }, [router, toast, addOverride, startTransition])

  const onToggle = useCallback((row: BillingRow) => {
    if (row.status === 'paid') {
      run(row.periodId, 'scheduled', `${row.brandName} marked unpaid.`, () => markPeriodUnpaid(row.periodId))
    } else {
      run(row.periodId, 'paid', `${row.brandName} — ${formatCents(row.amountCents)} marked paid.`,
        () => markPeriodPaid(row.periodId))
    }
  }, [run])

  const onWaive = useCallback((row: BillingRow) => {
    run(row.periodId, 'waived', `${row.brandName} waived for this month.`,
      () => setPeriodStatus(row.periodId, 'waived'))
  }, [run])

  const onVoid = useCallback(async (row: BillingRow) => {
    setMenuId(null)
    const ok = await confirm({
      title: 'Void this invoice?',
      message: `${row.brandName} — ${formatCents(row.amountCents)} due ${shortDateLabel(row.dueDate)}. Voiding drops it from both collected and outstanding, as if it was never billed. Use "Waive" instead if you comped the month on purpose.`,
      confirmLabel: 'Void it',
      danger: true,
    })
    if (!ok) return
    run(row.periodId, 'void', `${row.brandName} voided.`, () => setPeriodStatus(row.periodId, 'void'))
  }, [confirm, run])

  const onRestore = useCallback((row: BillingRow) => {
    run(row.periodId, 'scheduled', `${row.brandName} restored to unpaid.`,
      () => setPeriodStatus(row.periodId, 'scheduled'))
  }, [run])

  const onSaveAmount = useCallback((row: BillingRow, raw: string) => {
    setEditingId(null)
    if (parseMoneyToCents(raw) === row.amountCents) return
    run(row.periodId, null, `${row.brandName} amount updated.`, () => updatePeriodAmount(row.periodId, raw))
  }, [run])

  // Totals always reflect the WHOLE month, never the filtered subset — a
  // filter is a way to find rows, not a way to change what you owe.
  const totals = useMemo(() => {
    const billable = optimisticRows.filter(r => r.state !== 'void' && r.state !== 'waived')
    return {
      expected: billable.reduce((sum, r) => sum + r.amountCents, 0),
      collected: optimisticRows.filter(r => isCollected(r.state))
        .reduce((sum, r) => sum + (r.paidAmountCents ?? r.amountCents), 0),
      outstanding: optimisticRows.filter(r => isOutstanding(r.state))
        .reduce((sum, r) => sum + r.amountCents, 0),
      paidCount: optimisticRows.filter(r => isCollected(r.state)).length,
      billableCount: billable.length,
    }
  }, [optimisticRows])

  const displayed = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return optimisticRows.filter(r => {
      if (q && !r.brandName.toLowerCase().includes(q)) return false
      if (filter === 'unpaid' && !isOutstanding(r.state)) return false
      if (filter === 'paid' && !isCollected(r.state)) return false
      return true
    })
  }, [optimisticRows, deferredSearch, filter])

  const unpaidCount = optimisticRows.filter(r => isOutstanding(r.state)).length

  if (rows.length === 0) {
    return (
      <div className="card" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)', textAlign: 'center' }}>
        Nothing bills in {monthLabel}.
      </div>
    )
  }

  return (
    <div>
      {/* Filter bar — same shape as the pipeline's. */}
      <div style={{
        display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
        marginBottom: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <input
          type="text"
          placeholder="Search client…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 190, fontSize: 'var(--text-base)' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['unpaid', `Unpaid${unpaidCount > 0 ? ` (${unpaidCount})` : ''}`],
            ['paid', 'Paid'],
            ['all', 'All'],
          ] as const).map(([opt, label]) => {
            const active = filter === opt
            return (
              <button
                key={opt}
                onClick={() => setFilter(opt)}
                className="focus-ring-pill"
                style={{
                  padding: 'var(--space-2) var(--space-3)', borderRadius: 20,
                  fontSize: 'var(--text-sm)', cursor: 'pointer', transition: 'all 0.15s',
                  border: '1px solid',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'var(--accent-muted)' : 'transparent',
                  borderColor: active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border)',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        {isPending && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Saving…</span>
        )}
      </div>

      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12 }}>
        {/* Month summary — whole month, unaffected by the filter. */}
        <div style={{
          display: 'flex', gap: 'var(--space-8)', padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)',
          borderTopLeftRadius: 12, borderTopRightRadius: 12, flexWrap: 'wrap',
        }}>
          <SummaryStat label="Expected" value={formatCents(totals.expected)} />
          <SummaryStat label="Collected" value={formatCents(totals.collected)} color="var(--success)" />
          <SummaryStat
            label="Outstanding"
            value={formatCents(totals.outstanding)}
            color={totals.outstanding > 0 ? 'var(--danger)' : 'var(--text-primary)'}
          />
          <SummaryStat label="Paid" value={`${totals.paidCount} / ${totals.billableCount}`} />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-5)', borderBottom: '1px solid var(--border)',
        }}>
          {['', 'Client', 'Due', 'Amount', 'Status', ''].map((col, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>{col}</span>
          ))}
        </div>

        {displayed.length === 0 ? (
          <div style={{
            padding: 'var(--space-6)', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 'var(--text-base)',
          }}>
            {filter === 'unpaid' && unpaidCount === 0
              ? `Everything due in ${monthLabel} is settled.`
              : 'No invoices match.'}
          </div>
        ) : displayed.map((row, i) => (
          <BillingRowItem
            key={row.periodId}
            row={row}
            isLast={i === displayed.length - 1}
            menuOpen={menuId === row.periodId}
            editing={editingId === row.periodId}
            onOpenMenu={setMenuId}
            onStartEdit={setEditingId}
            onSaveAmount={onSaveAmount}
            onToggle={onToggle}
            onWaive={onWaive}
            onVoid={onVoid}
            onRestore={onRestore}
          />
        ))}
      </div>
    </div>
  )
}

const BillingRowItem = memo(function BillingRowItem({
  row, isLast, menuOpen, editing, onOpenMenu, onStartEdit, onSaveAmount,
  onToggle, onWaive, onVoid, onRestore,
}: {
  row: BillingRow
  isLast: boolean
  menuOpen: boolean
  editing: boolean
  onOpenMenu: (id: string | null) => void
  onStartEdit: (id: string | null) => void
  onSaveAmount: (row: BillingRow, raw: string) => void
  onToggle: (row: BillingRow) => void
  onWaive: (row: BillingRow) => void
  onVoid: (row: BillingRow) => void
  onRestore: (row: BillingRow) => void
}) {
  const paid = row.status === 'paid'
  const settled = row.status === 'waived' || row.status === 'void'

  return (
    <div className="pipeline-row" style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-5)',
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
      alignItems: 'center', opacity: settled ? 0.6 : 1,
      position: 'relative',
    }}>
      <button
        type="button"
        className="billing-check"
        data-paid={paid}
        onClick={() => onToggle(row)}
        disabled={settled}
        aria-label={paid ? `Mark ${row.brandName} unpaid` : `Mark ${row.brandName} paid`}
        title={settled ? PERIOD_STATE_LABEL[row.state] : paid ? 'Click to undo' : 'Mark paid'}
      >
        {paid && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <span style={{
        fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: row.status === 'void' ? 'line-through' : 'none',
      }}>
        {row.brandName}
      </span>

      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {shortDateLabel(row.dueDate)}
      </span>

      {/* Inline amount edit — replaces a window.prompt(), which blocked the tab
          and looked nothing like the rest of the app. */}
      {editing ? (
        <input
          type="text"
          autoFocus
          defaultValue={String(row.amountCents / 100)}
          aria-label={`Amount for ${row.brandName}`}
          onBlur={e => onSaveAmount(row, e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { e.currentTarget.value = String(row.amountCents / 100); e.currentTarget.blur() }
          }}
          style={{ width: '100%', padding: '4px 8px', fontSize: 'var(--text-base)' }}
        />
      ) : (
        <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {formatCents(row.amountCents)}
        </span>
      )}

      <span className={PERIOD_STATE_BADGE[row.state]}>
        {PERIOD_STATE_LABEL[row.state]}
      </span>

      <div style={{ position: 'relative', justifySelf: 'end' }}>
        <button
          type="button"
          onClick={() => onOpenMenu(menuOpen ? null : row.periodId)}
          aria-label={`More actions for ${row.brandName}`}
          style={{
            width: 26, height: 26, borderRadius: 6, border: '1px solid transparent',
            background: menuOpen ? 'var(--surface-raised)' : 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0,
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            <div onClick={() => onOpenMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{
              position: 'absolute', right: 0, top: 30, zIndex: 41,
              background: 'var(--surface-1)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 4, minWidth: 170,
              boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            }}>
              {settled
                ? <MenuItem label="Restore to unpaid" onClick={() => onRestore(row)} />
                : (
                  <>
                    <MenuItem label="Edit amount" onClick={() => { onOpenMenu(null); onStartEdit(row.periodId) }} />
                    <MenuItem label="Waive this month" onClick={() => onWaive(row)} />
                    <MenuItem label="Void invoice" onClick={() => onVoid(row)} danger />
                  </>
                )}
            </div>
          </>
        )}
      </div>
    </div>
  )
})

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent',
        color: danger ? 'var(--danger)' : 'var(--text-primary)',
        fontSize: 'var(--text-base)', cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-raised)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}

function SummaryStat({ label, value, color = 'var(--text-primary)' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color, letterSpacing: '-0.01em' }}>{value}</div>
    </div>
  )
}
