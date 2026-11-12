'use client'

import { useState, useTransition } from 'react'
import { submitCheckIn } from '@/lib/brands/checkin-actions'
import { EASE_LABELS } from '@/lib/brands/checkin'

// The client's check-in. Four questions, about two minutes, phone first.

export default function CheckInForm({ token, brandName }: { token: string; brandName: string }) {
  const [recommend, setRecommend] = useState<number | null>(null)
  const [why, setWhy] = useState('')
  const [ease, setEase] = useState<number | null>(null)
  const [success, setSuccess] = useState('')
  const [changed, setChanged] = useState<boolean | null>(null)
  const [changedNote, setChangedNote] = useState('')
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, start] = useTransition()

  function send() {
    if (recommend == null) { setErr('Pick a number from 0 to 10 for the first question.'); return }
    if (ease == null) { setErr('Pick how easy we are to work with.'); return }
    setErr('')
    start(async () => {
      const r = await submitCheckIn(token, {
        recommend, recommend_why: why, ease, success_90d: success,
        changed: changed === true, changed_note: changedNote,
      })
      if (!r.ok) { setErr(r.error); return }
      setSent(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  return (
    <div className="ik-page">
      <header className="ik-top">
        <div className="ik-top-inner"><span className="ik-brand">{brandName}</span></div>
      </header>
      <main className="ik-main">
        {sent ? (
          <div className="ik-card ik-thanks">
            <h2>Thank you</h2>
            <p>Your answers went straight to the Marketing Moments team. We read every one, and we&apos;ll use what you told us to plan the next few months with you.</p>
            <button className="ik-btn-secondary" onClick={() => setSent(false)}>Change my answers</button>
          </div>
        ) : (
          <>
            <section className="ik-intro">
              <h1>Quick check-in</h1>
              <p>Four questions, about two minutes. Honest answers help us most, good or bad.</p>
            </section>

            <section className="ik-card">
              <h2><span className="ik-step">1</span> How likely are you to recommend us to another brand?</h2>
              <div className="ci-scale" role="radiogroup" aria-label="0 is not at all likely, 10 is extremely likely">
                {Array.from({ length: 11 }, (_, n) => (
                  <button key={n} type="button" role="radio" aria-checked={recommend === n}
                    className={`ci-num${recommend === n ? ' on' : ''}`} onClick={() => setRecommend(n)}>{n}</button>
                ))}
              </div>
              <div className="ci-ends"><span>Not at all likely</span><span>Extremely likely</span></div>
              <label className="ik-field">
                <span>What&apos;s the main reason for your score?</span>
                <textarea rows={3} value={why} onChange={e => setWhy(e.target.value)} />
              </label>
            </section>

            <section className="ik-card">
              <h2><span className="ik-step">2</span> How easy are we to work with?</h2>
              <div className="ik-pills" role="radiogroup" aria-label="How easy we are to work with">
                {EASE_LABELS.map((l, i) => (
                  <button key={l} type="button" role="radio" aria-checked={ease === i + 1}
                    className={`ik-pill${ease === i + 1 ? ' on' : ''}`} onClick={() => setEase(i + 1)}>{l}</button>
                ))}
              </div>
            </section>

            <section className="ik-card">
              <h2><span className="ik-step">3</span> What would make the next 90 days a success for you?</h2>
              <label className="ik-field">
                <small>A number, a launch, a feeling. Whatever matters most to you.</small>
                <textarea rows={3} value={success} onChange={e => setSuccess(e.target.value)} />
              </label>
            </section>

            <section className="ik-card">
              <h2><span className="ik-step">4</span> Has anything changed on your side?</h2>
              <p className="ik-help">Your team, budget or priorities.</p>
              <div className="ik-pills" role="radiogroup" aria-label="Has anything changed">
                <button type="button" role="radio" aria-checked={changed === false} className={`ik-pill${changed === false ? ' on' : ''}`} onClick={() => setChanged(false)}>No</button>
                <button type="button" role="radio" aria-checked={changed === true} className={`ik-pill${changed === true ? ' on' : ''}`} onClick={() => setChanged(true)}>Yes</button>
              </div>
              {changed && (
                <label className="ik-field">
                  <span>What changed?</span>
                  <textarea rows={3} value={changedNote} onChange={e => setChangedNote(e.target.value)} />
                </label>
              )}
            </section>

            {err && <div className="ik-alert">{err}</div>}
            <div className="ik-submit">
              <button className="ik-btn" disabled={pending} onClick={send}>{pending ? 'Sending…' : 'Send'}</button>
              <p>Only the Marketing Moments team sees your answers.</p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
