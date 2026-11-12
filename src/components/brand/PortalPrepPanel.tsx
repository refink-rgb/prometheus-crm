'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import ClientPortalButton from '@/components/ClientPortalButton'
import { setPortalReady, setPromisedDate } from '@/lib/brands/portal-actions'
import './brand.css'

// Brand page: get the client's portal ready before it's shared. Internal due
// dates never reach the client; only a promised date does. Until someone marks
// the page checked, the portal shows a holding message instead of projects.

type P = { id: string; name: string; due_date: string | null; promised_date: string | null }

const today = () => new Date().toISOString().slice(0, 10)
const short = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00'))

export default function PortalPrepPanel({
  brandId, brandName, clientToken, readyAt, projects, canEdit,
}: {
  brandId: string
  brandName: string
  clientToken: string | null
  readyAt: string | null
  projects: P[] // open projects
  canEdit: boolean
}) {
  const router = useRouter()
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const late = projects.filter(p => p.due_date && p.due_date < today() && !p.promised_date)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const r = await fn()
      if (!r.ok) setErr(r.error ?? 'Something went wrong.')
      else { setErr(''); router.refresh() }
    })
  }

  return (
    <section className="mo-panel" aria-label="Client portal">
      <div className="bp-card-head">
        <div>
          <h2 className="mo-h2">Client portal</h2>
          <p className="bp-purpose">
            {readyAt
              ? `Checked ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(readyAt))}. ${brandName} sees their projects, with promised dates only.`
              : `Not checked yet. ${brandName} sees a holding message until someone sets promised dates and marks it checked.`}
          </p>
        </div>
      </div>
      <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {projects.length > 0 && (
          <div>
            <p className="bp-label">Date we&apos;ve promised the client</p>
            <ul className="pp-list">
              {projects.map(p => {
                const overdue = !!p.due_date && p.due_date < today()
                return (
                  <li key={p.id}>
                    <a href={`/brands/${brandId}/projects/${p.id}`} className="pp-name">{p.name}</a>
                    <span className={`pp-due${overdue ? ' late' : ''}`} title="Internal due date, never shown to the client">
                      {p.due_date ? `${overdue ? 'Late · ' : ''}internal ${short(p.due_date)}` : 'no internal date'}
                    </span>
                    <input type="date" aria-label={`Promised date for ${p.name}`} disabled={!canEdit || pending}
                      defaultValue={p.promised_date ?? ''}
                      onChange={e => run(() => setPromisedDate(p.id, brandId, e.target.value))} />
                  </li>
                )
              })}
            </ul>
            <p className="bp-hint" style={{ margin: '8px 0 0' }}>
              Leave it empty and the client sees the stage and what&apos;s next, with no date. Close anything that&apos;s really finished or dropped from its project page.
            </p>
          </div>
        )}
        {!readyAt && late.length > 0 && (
          <div className="bp-warn">{late.length} late project{late.length === 1 ? '' : 's'} with no promised date. Fine to share, but decide first whether to promise a new date.</div>
        )}
        {canEdit && (
          <div className="bp-actions">
            {readyAt
              ? <button className="bp-link bp-link-muted" disabled={pending} onClick={() => run(() => setPortalReady(brandId, false))}>Hide projects again</button>
              : <button className="btn-primary" style={{ fontSize: 13.5 }} disabled={pending} onClick={() => run(() => setPortalReady(brandId, true))}>Page checked, ready to share</button>}
          </div>
        )}
        {canEdit && <ClientPortalButton brandId={brandId} initialToken={clientToken} />}
        {err && <p className="mo-error">{err}</p>}
      </div>
    </section>
  )
}
