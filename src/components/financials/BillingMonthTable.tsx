'use client'

// The payment check-off surface: every invoice due in the selected month, with
// one click to mark it paid.
//
// Row state (`state`) is derived on the SERVER from Eastern today, not here —
// so a browser in another timezone, or a tab left open overnight, can't
// disagree with the rest of the app about whether something is overdue.

import { memo, useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import {
  formatCents,
  shortDateLabel,
  PERIOD_STATE_COLOR,
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

const GRID = '32px 1fr 90px 110px 110px 40px'

export default function BillingMonthTable({ rows, monthLabel }: { rows: BillingRow[]; monthLabel: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  const run = useCallback((id: string, label: string, fn: () => Promise<void>) => {
    setBusyId(id)
    setMenuId(null)
    startTransition(async () => {
      try {
        await fn()
        toast.success(label)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong.')
      } finally {
        setBusyId(null)
      }
    })
  }, [router, toast, startTransition])

  const onToggle = useCallback((row: BillingRow) => {
    if (row.status === 'paid') {
      run(row.periodId, `${row.brandName} marked unpaid.`, () => markPeriodUnpaid(row.periodId))
    } else {
      run(row.periodId, `${row.brandName} — ${formatCents(row.amountCents)} marked paid.`,
        () => markPeriodPaid(row.periodId))
    }
  }, [run])

  const onWaive = useCallback((row: BillingRow) => {
    run(row.periodId, `${row.brandName} waived for this month.`, () => setPeriodStatus(row.periodId, 'waived'))
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
    run(row.periodId, `${row.brandName} voided.`, () => setPeriodStatus(row.periodId, 'void'))
  }, [confirm, run])

  const onRestore = useCallback((row: BillingRow) => {
    run(row.periodId, `${row.brandName} restored to unpaid.`, () => setPeriodStatus(row.periodId, 'scheduled'))
  }, [run])

  const onEditAmount = useCallback((row: BillingRow) => {
    setMenuId(null)
    const raw = window.prompt(
      `Amount for ${row.brandName}, ${shortDateLabel(row.dueDate)}.\nThis month only — the ongoing retainer is unchanged.`,
      String(row.amountCents / 100),
    )
    if (raw === null) return
    run(row.periodId, `${row.brandName} amount updated.`, () => updatePeriodAmount(row.periodId, raw))
  }, [run])

  const expected = rows
    .filter(r => r.state !== 'void' && r.state !== 'waived')
    .reduce((sum, r) => sum + r.amountCents, 0)
  const collected = rows
    .filter(r => isCollected(r.state))
    .reduce((sum, r) => sum + (r.paidAmountCents ?? r.amountCents), 0)
  const outstanding = rows
    .filter(r => isOutstanding(r.state))
    .reduce((sum, r) => sum + r.amountCents, 0)

  if (rows.length === 0) {
    return (
      <div style={{
        padding: 24, background: 'var(--surface-1)', border: '1px solid var(--border)',
        borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center',
      }}>
        Nothing bills in {monthLabel}.
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'visible' }}>
      {/* Month summary */}
      <div style={{
        display: 'flex', gap: 28, padding: '14px 20px',
        borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)',
        borderTopLeftRadius: 12, borderTopRightRadius: 12, flexWrap: 'wrap',
      }}>
        <SummaryStat label="Expected" value={formatCents(expected)} />
        <SummaryStat label="Collected" value={formatCents(collected)} color="var(--success)" />
        <SummaryStat
          label="Outstanding"
          value={formatCents(outstanding)}
          color={outstanding > 0 ? 'var(--danger)' : 'var(--text-primary)'}
        />
        <SummaryStat
          label="Paid"
          value={`${rows.filter(r => isCollected(r.state)).length} / ${rows.filter(r => r.state !== 'void' && r.state !== 'waived').length}`}
        />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '10px 20px',
        borderBottom: '1px solid var(--border)',
      }}>
        {['', 'Client', 'Due', 'Amount', 'Status', ''].map((col, i) => (
          <span key={i} style={{
            fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>{col}</span>
        ))}
      </div>

      {rows.map((row, i) => (
        <BillingRowItem
          key={row.periodId}
          row={row}
          isLast={i === rows.length - 1}
          busy={busyId === row.periodId}
          menuOpen={menuId === row.periodId}
          onOpenMenu={setMenuId}
          onToggle={onToggle}
          onWaive={onWaive}
          onVoid={onVoid}
          onRestore={onRestore}
          onEditAmount={onEditAmount}
        />
      ))}
    </div>
  )
}

const BillingRowItem = memo(function BillingRowItem({
  row, isLast, busy, menuOpen, onOpenMenu, onToggle, onWaive, onVoid, onRestore, onEditAmount,
}: {
  row: BillingRow
  isLast: boolean
  busy: boolean
  menuOpen: boolean
  onOpenMenu: (id: string | null) => void
  onToggle: (row: BillingRow) => void
  onWaive: (row: BillingRow) => void
  onVoid: (row: BillingRow) => void
  onRestore: (row: BillingRow) => void
  onEditAmount: (row: BillingRow) => void
}) {
  const color = PERIOD_STATE_COLOR[row.state]
  const paid = row.status === 'paid'
  const settled = row.status === 'waived' || row.status === 'void'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '10px 20px',
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
      alignItems: 'center', opacity: busy ? 0.5 : settled ? 0.6 : 1,
      transition: 'opacity 120ms ease',
      position: 'relative',
    }}>
      {/* Check-off */}
      <button
        type="button"
        onClick={() => onToggle(row)}
        disabled={busy || settled}
        aria-label={paid ? `Mark ${row.brandName} unpaid` : `Mark ${row.brandName} paid`}
        title={settled ? PERIOD_STATE_LABEL[row.state] : paid ? 'Click to undo' : 'Mark paid'}
        style={{
          width: 20, height: 20, borderRadius: 6, padding: 0,
          border: `1.5px solid ${paid ? 'var(--success)' : 'var(--border-strong, var(--border))'}`,
          background: paid ? 'var(--success)' : 'transparent',
          cursor: busy || settled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
      >
        {paid && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <span style={{
        fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: row.status === 'void' ? 'line-through' : 'none',
      }}>
        {row.brandName}
      </span>

      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {shortDateLabel(row.dueDate)}
      </span>

      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
        {formatCents(row.amountCents)}
      </span>

      <span style={{
        fontSize: 11, fontWeight: 600, color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        padding: '2px 10px', borderRadius: 20, width: 'fit-content',
      }}>
        {PERIOD_STATE_LABEL[row.state]}
      </span>

      {/* Overflow menu */}
      <div style={{ position: 'relative', justifySelf: 'end' }}>
        <button
          type="button"
          onClick={() => onOpenMenu(menuOpen ? null : row.periodId)}
          disabled={busy}
          aria-label={`More actions for ${row.brandName}`}
          style={{
            width: 28, height: 28, borderRadius: 6, border: '1px solid transparent',
            background: menuOpen ? 'var(--surface-raised)' : 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1,
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            {/* Click-away catcher */}
            <div
              onClick={() => onOpenMenu(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            />
            <div style={{
              position: 'absolute', right: 0, top: 32, zIndex: 41,
              background: 'var(--surface-1)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 4, minWidth: 170,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            }}>
              {settled
                ? <MenuItem label="Restore to unpaid" onClick={() => onRestore(row)} />
                : (
                  <>
                    <MenuItem label="Edit amount…" onClick={() => onEditAmount(row)} />
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
        fontSize: 13, cursor: 'pointer',
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
