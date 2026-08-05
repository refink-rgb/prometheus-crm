import { freshnessOf, easternTimeLabel, shortDateLabel, STALE_AFTER_HOURS, type DailyResult } from '@/lib/results'

// "updated 6:58am · data through Aug 4", tinted amber past ~36h.
//
// NON-NEGOTIABLE for an LLM-fed pipeline. A stale dashboard that LOOKS fresh
// is worse than an empty one — it gets quoted in a client call. Both halves
// matter and say different things:
//
//   updated <time>      — when the agent last successfully pulled
//   data through <date> — the newest day we actually hold
//
// A fresh pull of old data is still a hole, and only showing both makes that
// visible.

export default function FreshnessStamp({
  rows,
  nowMs,
  align = 'right',
}: {
  rows: readonly DailyResult[]
  nowMs: number
  align?: 'left' | 'right'
}) {
  const f = freshnessOf(rows, nowMs)

  if (f.state === 'never') {
    return (
      <div style={{ textAlign: align, fontSize: 11, color: 'var(--text-muted)' }}>
        never updated
      </div>
    )
  }

  const latestReport = latestReportedAt(rows)
  const stale = f.state === 'stale'
  const color = stale ? 'var(--warning)' : 'var(--text-muted)'

  return (
    <div
      style={{ textAlign: align, fontSize: 11, color, lineHeight: 1.5, flexShrink: 0 }}
      title={stale
        ? `Last successful pull was ${formatAge(f.hours_ago)} ago — past the ${STALE_AFTER_HOURS}h threshold, so at least one daily run was missed.`
        : `Last successful pull was ${formatAge(f.hours_ago)} ago.`}
    >
      <div style={{ fontWeight: stale ? 700 : 500 }}>
        {stale && '⚠ '}
        updated {latestReport ? easternTimeLabel(latestReport) : '—'}
        {stale && ` · ${formatAge(f.hours_ago)} ago`}
      </div>
      <div>data through {f.data_through ? shortDateLabel(f.data_through) : '—'}</div>
    </div>
  )
}

function latestReportedAt(rows: readonly DailyResult[]): string | null {
  let best: string | null = null
  let bestMs = -1
  for (const r of rows) {
    const t = Date.parse(r.reported_at)
    if (Number.isFinite(t) && t > bestMs) {
      bestMs = t
      best = r.reported_at
    }
  }
  return best
}

function formatAge(hours: number | null): string {
  if (hours === null) return 'an unknown time'
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}
