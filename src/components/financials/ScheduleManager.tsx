'use client'

// Billing schedule control: one row per client retainer, with pause / resume /
// end / delete and a lifetime collected + outstanding figure.
//
// "End billing" and "Delete" are deliberately separate. Ending is churn — it
// stops future invoices and keeps every dollar already collected in the
// history. Deleting erases the schedule and its payments outright, and is only
// for a schedule created in error. The confirm copy spells out the difference,
// because picking the wrong one is not something you notice until month-end.

import { memo, useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import {
  formatCents,
  SUBSCRIPTION_STATUS_COLOR,
  SUBSCRIPTION_STATUS_LABEL,
  type SubscriptionStatus,
} from '@/lib/billing'
import {
  deleteSubscription,
  endSubscription,
  pauseSubscription,
  resumeSubscription,
  syncAllBillingPeriods,
  updateSubscriptionAmount,
} from '@/lib/billing-actions'

export type ScheduleRow = {
  id: string
  brandId: string
  brandName: string
  amountCents: number
  startDate: string
  status: SubscriptionStatus
  pausedFrom: string | null
  pausedUntil: string | null
  endedAt: string | null
  collectedCents: number
  outstandingCents: number
  unpaidCount: number
}

const GRID = '1fr 100px 110px 120px 120px 150px'

export default function ScheduleManager({ rows, today }: { rows: ScheduleRow[]; today: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = useCallback((id: string, label: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
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

  const onPause = useCallback(async (row: ScheduleRow) => {
    const from = window.prompt(
      `Pause ${row.brandName}'s billing starting when? (YYYY-MM-DD)\n\nInvoices due on or after this date stop generating. Payments already recorded are kept.`,
      today,
    )
    if (!from) return
    const until = window.prompt(
      `Resume on? (YYYY-MM-DD)\n\nLeave blank for an open-ended pause you'll lift by hand.`,
      '',
    )
    run(row.id, `${row.brandName} billing paused.`, () => pauseSubscription(row.id, from.trim(), until?.trim() || null))
  }, [run, today])

  const onResume = useCallback((row: ScheduleRow) => {
    run(row.id, `${row.brandName} billing resumed.`, () => resumeSubscription(row.id))
  }, [run])

  const onEnd = useCallback(async (row: ScheduleRow) => {
    const ok = await confirm({
      title: `End billing for ${row.brandName}?`,
      message: `No invoices will be generated from today onward, and ${row.brandName} drops out of MRR and the forecast. The ${formatCents(row.collectedCents)} already collected stays in your revenue history.${row.unpaidCount > 0 ? `\n\nHeads up: ${row.unpaidCount} unpaid invoice(s) are still outstanding. Anything not yet due will be removed; anything already due stays on the books so you can still chase it.` : ''}`,
      confirmLabel: 'End billing',
      danger: true,
    })
    if (!ok) return
    run(row.id, `${row.brandName} billing ended.`, () => endSubscription(row.id))
  }, [confirm, run])

  const onDelete = useCallback(async (row: ScheduleRow) => {
    const ok = await confirm({
      title: `Delete ${row.brandName}'s billing schedule?`,
      message: `This erases the schedule AND every payment recorded against it — ${formatCents(row.collectedCents)} of collected history will be gone. This cannot be undone.\n\nIf ${row.brandName} churned, use "End" instead: it stops future billing and keeps the history.`,
      confirmLabel: 'Delete permanently',
      danger: true,
    })
    if (!ok) return
    run(row.id, `${row.brandName} billing schedule deleted.`, () => deleteSubscription(row.id))
  }, [confirm, run])

  const onEditAmount = useCallback((row: ScheduleRow) => {
    const raw = window.prompt(
      `Monthly retainer for ${row.brandName}.\n\nApplies to future invoices only — already-issued months keep what they were billed.`,
      String(row.amountCents / 100),
    )
    if (raw === null) return
    run(row.id, `${row.brandName} retainer updated.`, () => updateSubscriptionAmount(row.id, raw))
  }, [run])

  const onSync = useCallback(() => {
    run('__sync__', 'Billing schedule synced.', async () => {
      const result = await syncAllBillingPeriods()
      if (result.created === 0 && result.removed === 0) toast.info('Already up to date.')
    })
  }, [run, toast])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
        <h2 style={{
          fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
        }}>
          Billing Schedules
        </h2>
        <button
          type="button"
          onClick={onSync}
          disabled={busyId === '__sync__'}
          title="Materialize any missing invoices through the end of next month. The nightly cron does this automatically."
          style={{
            fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 7,
            border: '1px solid var(--border)', background: 'var(--surface-1)',
            color: 'var(--text-secondary)', cursor: busyId === '__sync__' ? 'default' : 'pointer',
            opacity: busyId === '__sync__' ? 0.6 : 1,
          }}
        >
          {busyId === '__sync__' ? 'Syncing…' : 'Sync invoices'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{
          padding: 24, background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center',
        }}>
          No billing schedules yet — run <code>supabase/seed_billing.sql</code> to load the signed-contract sheet.
        </div>
      ) : (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '10px 20px',
            borderBottom: '1px solid var(--border)', background: 'var(--surface-raised)',
            borderTopLeftRadius: 12, borderTopRightRadius: 12,
          }}>
            {['Client', 'Retainer', 'Started', 'Collected', 'Outstanding', 'Status'].map(col => (
              <span key={col} style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>{col}</span>
            ))}
          </div>

          {rows.map((row, i) => (
            <ScheduleRowItem
              key={row.id}
              row={row}
              isLast={i === rows.length - 1}
              busy={busyId === row.id}
              onPause={onPause}
              onResume={onResume}
              onEnd={onEnd}
              onDelete={onDelete}
              onEditAmount={onEditAmount}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ScheduleRowItem = memo(function ScheduleRowItem({
  row, isLast, busy, onPause, onResume, onEnd, onDelete, onEditAmount,
}: {
  row: ScheduleRow
  isLast: boolean
  busy: boolean
  onPause: (row: ScheduleRow) => void
  onResume: (row: ScheduleRow) => void
  onEnd: (row: ScheduleRow) => void
  onDelete: (row: ScheduleRow) => void
  onEditAmount: (row: ScheduleRow) => void
}) {
  const color = SUBSCRIPTION_STATUS_COLOR[row.status]
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        opacity: busy ? 0.5 : row.status === 'cancelled' ? 0.62 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 12,
        padding: '11px 20px', alignItems: 'center',
      }}>
        <span style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {row.brandName}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          {formatCents(row.amountCents)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.startDate}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>
          {formatCents(row.collectedCents)}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: row.outstandingCents > 0 ? 'var(--danger)' : 'var(--text-muted)',
        }}>
          {row.outstandingCents > 0 ? formatCents(row.outstandingCents) : '—'}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          padding: '2px 10px', borderRadius: 20, width: 'fit-content',
        }}>
          {SUBSCRIPTION_STATUS_LABEL[row.status]}
          {row.status === 'paused' && row.pausedUntil ? ` → ${row.pausedUntil}` : ''}
        </span>
      </div>

      {/* Actions reveal on hover; always rendered so keyboard users can tab in. */}
      <div style={{
        display: 'flex', gap: 6, padding: hovered ? '0 20px 11px' : '0 20px',
        maxHeight: hovered ? 40 : 0, overflow: 'hidden',
        transition: 'max-height 140ms ease, padding 140ms ease',
      }}>
        <RowAction label="Edit retainer" onClick={() => onEditAmount(row)} disabled={busy} />
        {row.status === 'active' && <RowAction label="Pause" onClick={() => onPause(row)} disabled={busy} />}
        {row.status !== 'active' && <RowAction label="Resume" onClick={() => onResume(row)} disabled={busy} />}
        {row.status !== 'cancelled' && <RowAction label="End (churn)" onClick={() => onEnd(row)} disabled={busy} />}
        <RowAction label="Delete" onClick={() => onDelete(row)} disabled={busy} danger />
      </div>
    </div>
  )
})

function RowAction({ label, onClick, disabled, danger }: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
        border: `1px solid ${danger ? 'color-mix(in srgb, var(--danger) 35%, transparent)' : 'var(--border)'}`,
        background: 'var(--surface-raised)',
        color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}
