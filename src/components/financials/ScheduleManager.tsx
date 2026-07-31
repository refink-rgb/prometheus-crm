'use client'

// Billing schedule control: one row per client retainer, with pause / resume /
// end / delete and a lifetime collected + outstanding figure.
//
// "End billing" and "Delete" are deliberately separate. Ending is churn — it
// stops future invoices and keeps every dollar already collected in the
// history. Deleting erases the schedule and its payments outright, and is only
// for a schedule created in error. The confirm copy spells out the difference,
// because picking the wrong one is not something you notice until month-end.
//
// Editing happens INLINE (an input in the row, a pause panel under it) rather
// than through window.prompt — prompts blocked the tab, couldn't be styled,
// and made setting a pause window a two-dialog interrogation.

import { memo, useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import {
  formatCents,
  parseMoneyToCents,
  SUBSCRIPTION_STATUS_BADGE,
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

const GRID = '1fr 90px 100px 110px 110px 90px 150px'

// Which inline editor, if any, a row currently has open.
type RowMode = null | 'amount' | 'pause'

export default function ScheduleManager({ rows, today }: { rows: ScheduleRow[]; today: string }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<{ id: string; mode: RowMode }>({ id: '', mode: null })

  const closeEditor = useCallback(() => setOpenRow({ id: '', mode: null }), [])

  const run = useCallback((id: string, label: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
    closeEditor()
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
  }, [router, toast, startTransition, closeEditor])

  const onSaveAmount = useCallback((row: ScheduleRow, raw: string) => {
    closeEditor()
    if (parseMoneyToCents(raw) === row.amountCents) return
    run(row.id, `${row.brandName} retainer updated.`, () => updateSubscriptionAmount(row.id, raw))
  }, [run, closeEditor])

  const onSavePause = useCallback((row: ScheduleRow, from: string, until: string) => {
    run(row.id, `${row.brandName} billing paused.`, () => pauseSubscription(row.id, from, until || null))
  }, [run])

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

  const onSync = useCallback(() => {
    run('__sync__', 'Billing schedule synced.', async () => {
      const result = await syncAllBillingPeriods()
      if (result.created === 0 && result.removed === 0) toast.info('Already up to date.')
    })
  }, [run, toast])

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--space-4)', gap: 'var(--space-3)',
      }}>
        <h2 style={{
          fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
        }}>
          Billing Schedules
        </h2>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={onSync}
          disabled={busyId === '__sync__'}
          title="Materialize any missing invoices through the end of next month. The nightly cron does this automatically."
        >
          {busyId === '__sync__' ? 'Syncing…' : 'Sync invoices'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)', textAlign: 'center' }}>
          No billing schedules yet — run <code>supabase/seed_billing.sql</code> to load the signed-contract sheet.
        </div>
      ) : (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-5)', borderBottom: '1px solid var(--border)',
            background: 'var(--surface-raised)', borderTopLeftRadius: 12, borderTopRightRadius: 12,
          }}>
            {['Client', 'Retainer', 'Started', 'Collected', 'Outstanding', 'Status', ''].map((col, i) => (
              <span key={i} style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>{col}</span>
            ))}
          </div>

          {rows.map((row, i) => (
            <ScheduleRowItem
              key={row.id}
              row={row}
              today={today}
              isLast={i === rows.length - 1}
              busy={busyId === row.id && isPending}
              mode={openRow.id === row.id ? openRow.mode : null}
              onOpen={(mode) => setOpenRow({ id: row.id, mode })}
              onClose={closeEditor}
              onSaveAmount={onSaveAmount}
              onSavePause={onSavePause}
              onResume={onResume}
              onEnd={onEnd}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ScheduleRowItem = memo(function ScheduleRowItem({
  row, today, isLast, busy, mode, onOpen, onClose,
  onSaveAmount, onSavePause, onResume, onEnd, onDelete,
}: {
  row: ScheduleRow
  today: string
  isLast: boolean
  busy: boolean
  mode: RowMode
  onOpen: (mode: RowMode) => void
  onClose: () => void
  onSaveAmount: (row: ScheduleRow, raw: string) => void
  onSavePause: (row: ScheduleRow, from: string, until: string) => void
  onResume: (row: ScheduleRow) => void
  onEnd: (row: ScheduleRow) => void
  onDelete: (row: ScheduleRow) => void
}) {
  const [pauseFrom, setPauseFrom] = useState(today)
  const [pauseUntil, setPauseUntil] = useState('')

  return (
    <div style={{
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
      opacity: busy ? 0.5 : row.status === 'cancelled' ? 0.62 : 1,
      transition: 'opacity 0.12s ease',
    }}>
      <div className="pipeline-row" style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-5)', alignItems: 'center',
      }}>
        <span style={{
          fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {row.brandName}
        </span>

        {mode === 'amount' ? (
          <input
            type="text"
            autoFocus
            defaultValue={String(row.amountCents / 100)}
            aria-label={`Monthly retainer for ${row.brandName}`}
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

        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{row.startDate}</span>
        <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--success)' }}>
          {formatCents(row.collectedCents)}
        </span>
        <span style={{
          fontSize: 'var(--text-base)', fontWeight: 600,
          color: row.outstandingCents > 0 ? 'var(--danger)' : 'var(--text-muted)',
        }}>
          {row.outstandingCents > 0 ? formatCents(row.outstandingCents) : '—'}
        </span>
        <span className={SUBSCRIPTION_STATUS_BADGE[row.status]} style={{ width: 'fit-content' }}>
          {SUBSCRIPTION_STATUS_LABEL[row.status]}
        </span>

        {/* Hidden until the row is hovered or focused — see .row-actions. */}
        <div className="row-actions" style={{ display: 'flex', gap: 4, justifySelf: 'end' }}>
          <RowAction label="Edit" title="Change the monthly retainer" onClick={() => onOpen('amount')} disabled={busy} />
          {row.status === 'active'
            ? <RowAction label="Pause" onClick={() => onOpen('pause')} disabled={busy} />
            : <RowAction label="Resume" onClick={() => onResume(row)} disabled={busy} />}
          {row.status !== 'cancelled' && <RowAction label="End" title="Churn — stops future billing, keeps history" onClick={() => onEnd(row)} disabled={busy} />}
          <RowAction label="Delete" onClick={() => onDelete(row)} disabled={busy} danger />
        </div>
      </div>

      {/* Pause window editor, inline under its row. */}
      {mode === 'pause' && (
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap',
          padding: 'var(--space-3) var(--space-5) var(--space-4)',
          background: 'var(--surface-raised)', borderTop: '1px solid var(--border)',
        }}>
          <div>
            <label htmlFor={`pause-from-${row.id}`}>Pause from</label>
            <input
              id={`pause-from-${row.id}`}
              type="date"
              value={pauseFrom}
              onChange={e => setPauseFrom(e.target.value)}
              style={{ width: 165, padding: '6px 10px', fontSize: 'var(--text-base)' }}
            />
          </div>
          <div>
            <label htmlFor={`pause-until-${row.id}`}>Resume on (optional)</label>
            <input
              id={`pause-until-${row.id}`}
              type="date"
              value={pauseUntil}
              onChange={e => setPauseUntil(e.target.value)}
              style={{ width: 165, padding: '6px 10px', fontSize: 'var(--text-base)' }}
            />
          </div>
          <button
            type="button"
            className="btn-accent-outline btn-sm"
            onClick={() => onSavePause(row, pauseFrom, pauseUntil)}
            disabled={!pauseFrom}
          >
            Pause billing
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <p style={{
            fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
            margin: 0, flexBasis: '100%', lineHeight: 1.5,
          }}>
            Invoices due inside this window stop generating. Payments already recorded are kept.
            Leave the resume date blank for an open-ended pause you&apos;ll lift by hand.
          </p>
        </div>
      )}
    </div>
  )
})

function RowAction({ label, title, onClick, disabled, danger }: {
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={danger ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
      style={{ padding: '3px 9px', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}
    >
      {label}
    </button>
  )
}
