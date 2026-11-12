'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createIntakeLink } from '@/lib/brands/intake-actions'
import { markCheckInFollowedUp } from '@/lib/brands/checkin-actions'
import { requestCheckIn } from '@/lib/brands/portal-actions'
import { CHECKIN_EVERY_DAYS, EASE_LABELS, checkInAsked, checkInDue, recommendBand, type CheckIn } from '@/lib/brands/checkin'
import './brand.css'

// Brand page: what the client told us in their check-ins, whether one is due,
// and whether someone still needs to reach out.

const day = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))

export default function CheckInPanel({
  brandId, brandName, token, checkIns, requestedAt = null, canEdit,
}: {
  brandId: string
  brandName: string
  token: string | null
  checkIns: CheckIn[] // newest first
  requestedAt?: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [t, setT] = useState(token)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const latest = checkIns[0] ?? null
  const due = checkInDue(latest)
  const open = checkIns.filter(c => c.needs_follow_up && !c.followed_up_at)
  const asked = checkInAsked(requestedAt, latest)

  function ask(on: boolean) {
    start(async () => { const r = await requestCheckIn(brandId, on); if (!r.ok) setErr(r.error); else router.refresh() })
  }

  function copyLink() {
    start(async () => {
      let tok = t
      if (!tok) {
        const r = await createIntakeLink(brandId)
        if (!r.ok) { setErr(r.error); return }
        tok = r.token
        setT(tok)
        router.refresh()
      }
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/intake/${tok}/check-in`)
        setCopied(true); setTimeout(() => setCopied(false), 2000)
      } catch { setErr('Could not copy. Open the link and copy it from the address bar.') }
    })
  }

  function markDone(id: string) {
    start(async () => {
      const r = await markCheckInFollowedUp(id, brandId)
      if (!r.ok) setErr(r.error)
      else router.refresh()
    })
  }

  return (
    <section className="mo-panel" aria-label="Client check-in">
      <div className="bp-card-head">
        <div>
          <h2 className="mo-h2">Client check-in{checkIns.length > 0 && <span className="mo-count"> · {checkIns.length}</span>}</h2>
          <p className="bp-purpose">
            {latest
              ? `${brandName} last answered ${day(latest.created_at)}.${due ? ' A new check-in is due.' : ''}`
              : `${brandName} hasn't answered a check-in yet.`}
            {asked
              ? ' Showing on their portal now.'
              : due ? ' It shows on their portal automatically.' : ` It shows on their portal again ${CHECKIN_EVERY_DAYS} days after the last answer.`}
          </p>
        </div>
        {canEdit && (
          <div className="bp-actions">
            <button className={due ? 'btn-primary' : 'bp-link'} style={{ fontSize: 13.5 }} disabled={pending} onClick={copyLink}>
              {copied ? '✓ Copied' : 'Copy check-in link'}
            </button>
            {!due && (asked
              ? <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} disabled={pending} onClick={() => ask(false)}>Stop asking</button>
              : <button className="bp-link" style={{ fontSize: 13 }} disabled={pending} onClick={() => ask(true)}>Ask for a check-in now</button>)}
            {t && <a className="bp-link bp-link-muted" style={{ fontSize: 13 }} href={`/intake/${t}/check-in`} target="_blank" rel="noreferrer">Open as client ↗</a>}
          </div>
        )}
      </div>

      <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {open.map(c => (
          <div key={c.id} className="bp-warn ci-flag">
            <span>
              <b>Needs follow-up</b> · {flagReasons(c).join(' · ')} ({day(c.created_at)})
            </span>
            {canEdit && <button className="bp-link" style={{ fontSize: 13 }} disabled={pending} onClick={() => markDone(c.id)}>Mark followed up</button>}
          </div>
        ))}

        {latest ? (
          <>
            {latest.success_90d && (
              <div className="ci-goal">
                <p className="bp-label">Their goal for the next 90 days</p>
                <p>{latest.success_90d}</p>
              </div>
            )}
            <dl className="bp-dl">
              <dt>Would recommend</dt>
              <dd><span className={`ci-score ci-${recommendBand(latest.recommend)}`}>{latest.recommend}/10</span>{latest.recommend_why && <> · {latest.recommend_why}</>}</dd>
              <dt>Easy to work with</dt>
              <dd>{EASE_LABELS[latest.ease - 1] ?? latest.ease} ({latest.ease}/5)</dd>
              <dt>Changes</dt>
              <dd>{latest.changed ? (latest.changed_note || 'Yes, no details given') : 'None'}</dd>
            </dl>
            {checkIns.length > 1 && (
              <div>
                <p className="bp-label">Recommend score over time</p>
                <ol className="ci-history">
                  {[...checkIns].reverse().map(c => (
                    <li key={c.id} title={day(c.created_at)}>
                      <span className={`ci-score ci-${recommendBand(c.recommend)}`}>{c.recommend}</span>
                      <small>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(c.created_at))}</small>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {checkIns.some(c => c.followed_up_at) && (
              <p className="bp-empty" style={{ fontSize: 13 }}>
                {checkIns.filter(c => c.followed_up_at).map(c => `${day(c.created_at)} followed up by ${c.followed_up_by ?? 'the team'}`).join(' · ')}
              </p>
            )}
          </>
        ) : (
          <p className="bp-empty">Copy the link and send it with your next message. Their answers land here, and a low score or a change on their side shows a follow-up flag.</p>
        )}
        {err && <p className="mo-error">{err}</p>}
      </div>
    </section>
  )
}

function flagReasons(c: CheckIn) {
  const r: string[] = []
  if (c.recommend <= 6) r.push(`recommend ${c.recommend}/10`)
  if (c.ease <= 2) r.push(`ease ${c.ease}/5`)
  if (c.changed) r.push('something changed on their side')
  return r
}
