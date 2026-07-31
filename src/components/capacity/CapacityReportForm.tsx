'use client'

// The Friday form. Two parts, deliberately in this order:
//   A — one row per moment you touched (hours + what got in the way)
//   B — five questions about the week as a whole
//
// Design constraint: five minutes. With ~36 moments a month across 18 clients,
// most people touch three or four in a week, so that's ~4 rows plus 5 answers.
// A form that takes fifteen minutes gets filled with noise by week three, and
// noise is worse than nothing because you'd act on it.
//
// Uncontrolled inputs + FormData on submit, same as ProjectEditForm — no
// per-keystroke re-render across a table of rows.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import {
  CAPACITY_BRIEFS_READY,
  CAPACITY_SLIP_CAUSES,
  type CapacityReport,
} from '@/lib/types'
import { submitCapacityReport } from '@/lib/capacity-actions'

export type MomentOption = {
  projectId: string
  track: 'lp' | 'creative'
  label: string
}

export type ExistingEntry = {
  projectId: string | null
  track: 'lp' | 'creative'
  label: string
  hours: number | null
  cause: string | null
}

const TRACK_LABEL: Record<'lp' | 'creative', string> = { lp: 'LP', creative: 'Creatives' }
const TRACK_COLOR: Record<'lp' | 'creative', string> = {
  lp: 'var(--editor-lp)',
  creative: 'var(--editor-creative)',
}

const ENTRY_GRID = '1fr 90px 260px'

export default function CapacityReportForm({
  moments,
  existing,
  report,
  rotating,
  alreadySubmitted,
}: {
  moments: MomentOption[]
  existing: ExistingEntry[]
  report: CapacityReport | null
  rotating: { key: string; question: string }
  alreadySubmitted: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [hours, setHours] = useState<Record<string, string>>(() =>
    Object.fromEntries(existing
      .filter(e => e.projectId)
      .map(e => [`${e.projectId}_${e.track}`, e.hours == null ? '' : String(e.hours)])),
  )

  const prior = (key: string) => existing.find(e => `${e.projectId}_${e.track}` === key)

  // Live total, so someone can sanity-check "did I really log 47 hours?" before
  // submitting rather than after.
  const totalHours = Object.values(hours)
    .reduce((sum, v) => sum + (Number(v) || 0), 0)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await submitCapacityReport(formData)
        toast.success(alreadySubmitted ? 'Report updated.' : 'Report submitted — thanks.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save your report.')
      }
    })
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      {/* ---- Part A: moments ---- */}
      <SectionHeading
        title="Moments you worked on"
        hint="Focused hours — heads-down time, not elapsed days. Prometheus already tracks how long a card sat in a stage; it can't see how much of that was actual work. Leave a row blank if you didn't touch it."
      />

      {moments.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)', marginBottom: 'var(--space-8)' }}>
          No in-flight moments are assigned to you right now, so there&apos;s nothing to log.
          Fill in the week&apos;s questions below.
        </div>
      ) : (
        <div style={{
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 12, marginBottom: 'var(--space-8)',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: ENTRY_GRID, gap: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-5)', borderBottom: '1px solid var(--border)',
            background: 'var(--surface-raised)', borderTopLeftRadius: 12, borderTopRightRadius: 12,
          }}>
            {['Moment', 'Hours', 'What got in the way?'].map(col => (
              <span key={col} style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>{col}</span>
            ))}
          </div>

          {moments.map((m, i) => {
            const key = `${m.projectId}_${m.track}`
            const previous = prior(key)
            return (
              <div key={key} className="pipeline-row" style={{
                display: 'grid', gridTemplateColumns: ENTRY_GRID, gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-5)', alignItems: 'center',
                borderBottom: i === moments.length - 1 ? 'none' : '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    color: TRACK_COLOR[m.track],
                    background: `color-mix(in srgb, ${TRACK_COLOR[m.track]} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${TRACK_COLOR[m.track]} 30%, transparent)`,
                    padding: '2px 7px', borderRadius: 5, flexShrink: 0,
                  }}>
                    {TRACK_LABEL[m.track]}
                  </span>
                  <span style={{
                    fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {m.label}
                  </span>
                </div>

                <input type="hidden" name={`entry_${m.projectId}_${m.track}_label`} value={m.label} />

                <input
                  type="number"
                  min="0"
                  step="0.5"
                  inputMode="decimal"
                  placeholder="—"
                  name={`entry_${m.projectId}_${m.track}_hours`}
                  value={hours[key] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [key]: e.target.value }))}
                  aria-label={`Focused hours on ${m.label} (${TRACK_LABEL[m.track]})`}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 'var(--text-base)' }}
                />

                <select
                  name={`entry_${m.projectId}_${m.track}_cause`}
                  defaultValue={previous?.cause ?? 'on_track'}
                  aria-label={`What got in the way on ${m.label}`}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 'var(--text-base)' }}
                >
                  {CAPACITY_SLIP_CAUSES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            )
          })}

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-3) var(--space-5)', borderTop: '1px solid var(--border)',
            background: 'var(--surface-raised)',
            borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
          }}>
            <span style={{
              fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              Total focused hours
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
              {totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}
            </span>
          </div>
        </div>
      )}

      {/* ---- Part B: the week ---- */}
      <SectionHeading title="Your week" />

      <div className="card" style={{ display: 'grid', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
        <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-5)' }}>
          <Field
            label="How loaded were you this week?"
            hint="1 = plenty of room, 5 = underwater"
          >
            <select name="load_rating" defaultValue={report?.load_rating ?? ''} style={{ width: '100%' }}>
              <option value="">—</option>
              <option value="1">1 — plenty of room</option>
              <option value="2">2 — comfortable</option>
              <option value="3">3 — full but fine</option>
              <option value="4">4 — stretched</option>
              <option value="5">5 — underwater</option>
            </select>
          </Field>

          <Field
            label="How many moments would have been right?"
            hint={`You carried ${moments.length}. This is the number that makes it a staffing decision instead of a feeling.`}
          >
            <input
              type="number"
              min="0"
              max="30"
              name="sustainable_moments"
              defaultValue={report?.sustainable_moments ?? ''}
              placeholder={String(moments.length)}
              style={{ width: '100%' }}
            />
          </Field>
        </div>

        <Field
          label="What's at risk next week, and why?"
          hint="The only forward-looking signal we collect — everything in Insights is after the fact."
        >
          <textarea
            name="at_risk_next_week"
            rows={2}
            defaultValue={report?.at_risk_next_week ?? ''}
            placeholder="e.g. Cookt M2 creatives — still no product photos, and the brief lands Tuesday."
          />
        </Field>

        <Field
          label="Did every card you picked up have what it needed to start?"
          hint="Brief quality is upstream of most slips and nothing else measures it."
        >
          <select name="briefs_ready" defaultValue={report?.briefs_ready ?? ''} style={{ width: '100%' }}>
            <option value="">—</option>
            {CAPACITY_BRIEFS_READY.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="text"
            name="briefs_ready_detail"
            defaultValue={report?.briefs_ready_detail ?? ''}
            placeholder="If not — which one, and what was missing?"
            style={{ marginTop: 'var(--space-2)' }}
          />
        </Field>

        <Field
          label="What's the single biggest thing that slowed you down?"
          hint="One thing on purpose. Asking for three gets filler."
        >
          <textarea
            name="biggest_blocker"
            rows={2}
            defaultValue={report?.biggest_blocker ?? ''}
          />
        </Field>

        <Field label="What would you change about how we run moments?">
          <textarea
            name="improvement"
            rows={2}
            defaultValue={report?.improvement ?? ''}
          />
        </Field>

        <Field label={rotating.question} hint="Rotates monthly.">
          <textarea
            name="rotating_answer"
            rows={2}
            defaultValue={report?.rotating_answer ?? ''}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? 'Saving…' : alreadySubmitted ? 'Update report' : 'Submit report'}
        </button>
        {alreadySubmitted && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Already submitted this week — saving again replaces it.
          </span>
        )}
      </div>
    </form>
  )
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <h2 style={{
        fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-muted)',
        letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
      }}>
        {title}
      </h2>
      {hint && (
        <p style={{
          fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
          margin: '6px 0 0', lineHeight: 1.6, maxWidth: 700,
        }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 600, marginBottom: hint ? 2 : 8 }}>
        {label}
      </label>
      {hint && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}
