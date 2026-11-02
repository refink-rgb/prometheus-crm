'use client'

import { useActionState, useRef, useState } from 'react'
import { uploadRevenueSheet, type RevenueUploadState } from '@/lib/revenue-actions'

export default function RevenueUpload({ defaultYear, lastUpload }: {
  defaultYear: number
  lastUpload: { fileName: string; uploadedAt: string; uploadedBy: string | null } | null
}) {
  const [state, action, pending] = useActionState<RevenueUploadState | null, FormData>(uploadRevenueSheet, null)
  const [open, setOpen] = useState(lastUpload === null)
  const fileRef = useRef<HTMLInputElement>(null)

  const when = lastUpload
    ? new Date(lastUpload.uploadedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
    : null

  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 'var(--space-3) var(--space-5)', marginBottom: 'var(--space-6)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {lastUpload
            ? <>Revenue from <strong style={{ color: 'var(--text-primary)' }}>{lastUpload.fileName}</strong> · uploaded {when}{lastUpload.uploadedBy ? ` by ${lastUpload.uploadedBy.split('@')[0]}` : ''}</>
            : 'No revenue sheet uploaded yet.'}
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(o => !o)}>
          {open ? 'Close' : 'Upload new sheet'}
        </button>
      </div>

      {open && (
        <form action={action} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            Sheet (.xlsx)
            <input ref={fileRef} type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required
              style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            Year of first month column
            <input type="number" name="year" defaultValue={defaultYear} min={2020} max={2100} style={{ width: 110 }} />
          </label>
          <button type="submit" className="btn-primary btn-sm" disabled={pending}>
            {pending ? 'Uploading…' : 'Upload'}
          </button>
          <p style={{ flexBasis: '100%', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 0 }}>
            Same layout as the Revenue Prometheus sheet: a &quot;Client&quot; header row with Service, Start Date, Fee and one column per month.
            A typed number in the &quot;Month Projection&quot; row is read as that month&apos;s target. Each upload replaces what the dashboard shows; older uploads are kept.
          </p>
        </form>
      )}

      {state && (
        <div role="status" style={{
          marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 8, fontSize: 'var(--text-sm)', lineHeight: 1.5,
          background: `color-mix(in srgb, ${state.ok ? 'var(--success)' : 'var(--danger)'} 9%, var(--surface-1))`,
          border: `1px solid color-mix(in srgb, ${state.ok ? 'var(--success)' : 'var(--danger)'} 30%, var(--border))`,
          color: 'var(--text-primary)',
        }}>
          {state.message}
          {state.unmatched && state.unmatched.length > 0 && (
            <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
              {state.unmatched.length} client name{state.unmatched.length === 1 ? '' : 's'} didn&apos;t match a CRM brand, so delays and results can&apos;t be linked to them: {state.unmatched.join(', ')}.
              Rename them in the sheet or the brand to match, then upload again.
            </div>
          )}
          {state.warnings && state.warnings.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--text-secondary)' }}>
              {state.warnings.map(w => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
