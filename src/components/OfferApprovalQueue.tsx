'use client'

import { useState, useTransition } from 'react'
import { approveOfferFromLink, requestOfferChangesFromLink } from '@/lib/approval-actions'
import { STRATEGIST_APPROVERS } from '@/lib/types'
import type { OfferApprovalState, ApprovalSide } from '@/lib/offer-approvals'

export interface ApprovalQueueItem {
  id: string
  brandName: string
  monthLabel: string
  momentSlot: number
  title: string
  mechanics: string | null
  product: string | null
  message: string | null
  approval: OfferApprovalState
}

export default function OfferApprovalQueue({
  token,
  engineerName,
  items,
}: {
  token: string
  engineerName: string
  items: ApprovalQueueItem[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map(item => (
        <OfferApprovalCard key={item.id} token={token} engineerName={engineerName} item={item} />
      ))}
    </div>
  )
}

function OfferApprovalCard({
  token,
  engineerName,
  item,
}: {
  token: string
  engineerName: string
  item: ApprovalQueueItem
}) {
  const [isPending, startTransition] = useTransition()
  // Which control is mid-flight, so only that button shows a busy state.
  const [busy, setBusy] = useState<null | ApprovalSide | 'changes'>(null)
  const [error, setError] = useState<string | null>(null)
  // The strategist button is a named pair, so it asks who before it commits.
  const [pickingApprover, setPickingApprover] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const { approval } = item
  const busyAny = isPending || busy !== null

  function approve(side: ApprovalSide, approver: string) {
    setError(null)
    setBusy(side)
    setPickingApprover(false)
    startTransition(async () => {
      try {
        const { advanced } = await approveOfferFromLink(token, item.id, side, approver)
        setDone(advanced
          ? 'Both approvals in — this offer moved to Client Review.'
          : 'Approved. Waiting on the other approval.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record the approval.')
      } finally {
        setBusy(null)
      }
    })
  }

  function requestChanges() {
    setError(null)
    setBusy('changes')
    startTransition(async () => {
      try {
        await requestOfferChangesFromLink(token, item.id, note, engineerName)
        setDone('Sent back to the strategist with your note.')
        setRequesting(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send the offer back.')
      } finally {
        setBusy(null)
      }
    })
  }

  return (
    <article style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${approval.complete ? 'var(--success)' : 'var(--stage-internal)'}`,
      borderRadius: 12,
      overflow: 'hidden',
      opacity: done ? 0.75 : 1,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ padding: '16px 20px 4px' }}>
        <div style={{
          fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
          display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6,
        }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{item.brandName}</span>
          <span>·</span>
          <span>{item.monthLabel} · M{item.momentSlot}</span>
          {item.mechanics && <><span>·</span><span>{item.mechanics}</span></>}
        </div>

        <h2 style={{
          fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.35, marginBottom: 10,
        }}>
          {item.title}
        </h2>

        {/* The AI-written approval message is the whole brief here — it is what
            the engineer reads to decide, so it gets the room. */}
        {item.message?.trim() ? (
          <div style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 16px',
            fontSize: 'var(--text-base)',
            color: 'var(--text-primary)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {item.message}
          </div>
        ) : (
          <div style={{
            border: '1px dashed var(--border)', borderRadius: 10,
            padding: '14px 16px', fontSize: 'var(--text-base)', color: 'var(--text-muted)',
          }}>
            No approval message has been written for this offer yet. Ask the strategist
            to generate it before approving.
          </div>
        )}

        {approval.changesRequested && approval.changesRequestedNote && (
          <div style={{
            marginTop: 10,
            background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
            borderRadius: 10, padding: '10px 14px',
            fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--warning)' }}>Changes requested</strong>
            {approval.changesRequestedBy ? ` by ${approval.changesRequestedBy}` : ''}: {approval.changesRequestedNote}
          </div>
        )}
      </div>

      {/* Approval state — who has signed off so far. */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        padding: '12px 20px 0',
      }}>
        <ApprovalStamp label={approval.strategist.label} state={approval.strategist} />
        <ApprovalStamp label={approval.engineer.label} state={approval.engineer} />
        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {approval.count} of 2 approved
        </span>
      </div>

      {done ? (
        <p style={{
          margin: '12px 20px 18px', fontSize: 'var(--text-sm)', fontWeight: 600,
          color: 'var(--success)',
        }}>
          ✓ {done}
        </p>
      ) : (
        <div style={{ padding: '14px 20px 18px' }}>
          {error && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', marginBottom: 10 }}>{error}</p>
          )}

          {pickingApprover ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Approving as</span>
              {STRATEGIST_APPROVERS.map(name => (
                <button
                  key={name}
                  type="button"
                  disabled={busyAny}
                  onClick={() => approve('strategist', name)}
                  style={primaryBtn}
                >
                  {name}
                </button>
              ))}
              <button type="button" onClick={() => setPickingApprover(false)} style={ghostBtn}>
                Cancel
              </button>
            </div>
          ) : requesting ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor={`note-${item.id}`} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                What needs to change?
              </label>
              <textarea
                id={`note-${item.id}`}
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. Margin is too thin at 25% off — can we cap it at 20%?"
                style={{
                  width: '100%', fontSize: 'var(--text-base)', padding: '8px 10px',
                  borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--surface-2)', color: 'var(--text-primary)',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={busyAny || !note.trim()}
                  onClick={requestChanges}
                  style={{ ...dangerBtn, opacity: !note.trim() ? 0.5 : 1 }}
                >
                  {busy === 'changes' ? 'Sending…' : 'Send back to strategist'}
                </button>
                <button type="button" onClick={() => setRequesting(false)} style={ghostBtn}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={busyAny || approval.strategist.approved}
                onClick={() => setPickingApprover(true)}
                style={approval.strategist.approved ? doneBtn : primaryBtn}
              >
                {approval.strategist.approved ? '✓ Lucas/Roberto approved' : 'Lucas/Roberto Approval'}
              </button>
              <button
                type="button"
                disabled={busyAny || approval.engineer.approved}
                onClick={() => approve('engineer', engineerName)}
                style={approval.engineer.approved ? doneBtn : primaryBtn}
              >
                {approval.engineer.approved
                  ? '✓ Profit Engineer approved'
                  : busy === 'engineer' ? 'Approving…' : 'Profit Engineer Approval'}
              </button>
              <button
                type="button"
                disabled={busyAny}
                onClick={() => setRequesting(true)}
                style={{ ...ghostBtn, marginLeft: 'auto' }}
              >
                Request changes
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function ApprovalStamp({ label, state }: { label: string; state: { approved: boolean; by: string | null } }) {
  return (
    <span
      title={state.approved && state.by ? `Approved by ${state.by}` : 'Not yet approved'}
      style={{
        fontSize: 'var(--text-2xs)', fontWeight: 700, whiteSpace: 'nowrap',
        borderRadius: 20, padding: '3px 9px',
        color: state.approved ? 'var(--success)' : 'var(--text-muted)',
        background: state.approved ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'transparent',
        border: `1px solid ${state.approved
          ? 'color-mix(in srgb, var(--success) 30%, transparent)'
          : 'var(--border)'}`,
      }}
    >
      {state.approved ? '✓ ' : ''}{label}
    </span>
  )
}

const baseBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, fontSize: 'var(--text-sm)',
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
}
const primaryBtn: React.CSSProperties = {
  ...baseBtn, background: 'var(--accent)', color: '#fff',
}
const doneBtn: React.CSSProperties = {
  ...baseBtn,
  background: 'color-mix(in srgb, var(--success) 12%, transparent)',
  borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)',
  color: 'var(--success)', cursor: 'default',
}
const ghostBtn: React.CSSProperties = {
  ...baseBtn, background: 'transparent',
  borderColor: 'var(--border)', color: 'var(--text-muted)', fontWeight: 500,
}
const dangerBtn: React.CSSProperties = {
  ...baseBtn,
  background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
  borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)',
  color: 'var(--danger)',
}
