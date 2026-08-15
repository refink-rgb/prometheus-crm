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
  createSubscription,
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

// An active client with no billing schedule yet. Until one exists the brand is
// invisible to every ledger section on this page — KPIs, Payments, and Moment
// Delivery all read through billing_subscriptions — so this is the gap that
// lets a client onboarded after the contract-sheet seed fall silently out of
// financials.
export type AddableBrand = {
  id: string
  name: string
  // Already on the brand row; used to prefill the form so the schedule and the
  // brand can't disagree about the retainer on day one.
  monthlyRetainer: number | null
  startDate: string | null
}

const GRID = '1fr 90px 100px 110px 110px 90px 150px'

// Which inline editor, if any, a row currently has open.
type RowMode = null | 'amount' | 'pause'

export default function ScheduleManager({
  rows,
  today,
  addableBrands,
}: {
  rows: ScheduleRow[]
  today: string
  addableBrands: AddableBrand[]
}) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<{ id: string; mode: RowMode }>({ id: '', mode: null })
  const [adding, setAdding] = useState(false)

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

  const onCreate = useCallback((brandId: string, startDate: string, amount: string) => {
    const name = addableBrands.find(b => b.id === brandId)?.name ?? 'Client'
    run('__create__', `${name} added to billing.`, async () => {
      const form = new FormData()
      form.set('brand_id', brandId)
      form.set('start_date', startDate)
      form.set('amount', amount)
      await createSubscription(form)
      setAdding(false)
    })
  }, [run, addableBrands])

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn-accent-outline btn-sm"
            onClick={() => setAdding(v => !v)}
            disabled={busyId === '__create__' || addableBrands.length === 0}
            title={addableBrands.length === 0
              ? 'Every active client already has a billing schedule.'
              : `${addableBrands.length} active client${addableBrands.length !== 1 ? 's have' : ' has'} no billing schedule yet`}
          >
            {adding ? 'Cancel' : `Add client${addableBrands.length > 0 ? ` (${addableBrands.length})` : ''}`}
          </button>
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
      </div>

      {adding && (
        <AddScheduleForm
          brands={addableBrands}
          today={today}
          busy={busyId === '__create__'}
          onSubmit={onCreate}
          onCancel={() => setAdding(false)}
        />
      )}

      {rows.length === 0 && !adding ? (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)', textAlign: 'center' }}>
          No billing schedules yet — run <code>supabase/seed_billing.sql</code> to load the
          signed-contract sheet, or add a client above.
        </div>
      ) : rows.length === 0 ? null : (
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

// Start a client's retainer. Picking the brand prefills the retainer and start
// date already recorded on the brand row — that pairing is almost always what
// the schedule should be, and typing it a second time is how the two drift
// apart. Both stay editable, because the brand row is often the stale one.
function AddScheduleForm({
  brands,
  today,
  busy,
  onSubmit,
  onCancel,
}: {
  brands: AddableBrand[]
  today: string
  busy: boolean
  onSubmit: (brandId: string, startDate: string, amount: string) => void
  onCancel: () => void
}) {
  const [brandId, setBrandId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [amount, setAmount] = useState('')

  const pickBrand = (id: string) => {
    setBrandId(id)
    const brand = brands.find(b => b.id === id)
    if (!brand) return
    setStartDate(brand.startDate ?? today)
    setAmount(brand.monthlyRetainer != null ? String(brand.monthlyRetainer) : '')
  }

  const ready = brandId !== '' && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && amount.trim() !== ''

  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="add-sched-brand">Client</label>
          <select
            id="add-sched-brand"
            value={brandId}
            onChange={e => pickBrand(e.target.value)}
            // Global CSS sets select { width: 100% }; an inline-sized select
            // has to say so explicitly or it swallows the row.
            style={{ width: 240, padding: '6px 10px', fontSize: 'var(--text-base)' }}
          >
            <option value="">Pick a client…</option>
            {brands.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="add-sched-start">First invoice date</label>
          <input
            id="add-sched-start"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ width: 165, padding: '6px 10px', fontSize: 'var(--text-base)' }}
          />
        </div>
        <div>
          <label htmlFor="add-sched-amount">Monthly retainer</label>
          <input
            id="add-sched-amount"
            type="text"
            inputMode="decimal"
            placeholder="2500"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ width: 120, padding: '6px 10px', fontSize: 'var(--text-base)' }}
          />
        </div>
        <button
          type="button"
          className="btn-accent btn-sm"
          disabled={!ready || busy}
          onClick={() => onSubmit(brandId, startDate, amount)}
        >
          {busy ? 'Adding…' : 'Add schedule'}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <p style={{
        fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
        margin: 'var(--space-3) 0 0', lineHeight: 1.5,
      }}>
        Every invoice from the first date through the end of next month is created as{' '}
        <strong>scheduled</strong> — mark the ones already collected as paid in the Payments table
        above, since only paid invoices count toward moments owed. Only active clients without a
        schedule are listed here.
      </p>
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
