'use client'

// Phase 4 insights — read-only charts over the event stream. All figures come
// pre-computed from src/lib/insights.ts; this file is presentation only.
//
// Charts are plain HTML/CSS bars (not a chart lib) so the validated palette,
// direct labels, and empty states are fully under our control. Every panel
// degrades to a clear "no data yet" state — expected until ~2 weeks of events
// have accrued (the brief's Phase 4 timing note).

import type { BarDatum, InsightsData, SlipBuckets } from '@/lib/insights'

export default function InsightsCharts({ data }: { data: InsightsData }) {
  const noEvents = data.event_count === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      {noEvents && (
        <div style={{
          background: 'var(--surface-1)', border: '1px dashed var(--border-strong)',
          borderRadius: 12, padding: '20px 24px', color: 'var(--text-muted)', fontSize: 13,
        }}>
          No pipeline events recorded yet. These dashboards fill in as cards move through
          the pipeline — the event log started when Phase 1 shipped, and the brief expects
          ~2 weeks of activity before the numbers are meaningful. Everything below is wired
          and will populate automatically.
        </div>
      )}

      {/* ── Dashboard 1: Production Capacity ─────────────────────────────── */}
      <section>
        <SectionHeader
          title="Production Capacity"
          subtitle="How work flows through the team — throughput, load, and time in build."
        />

        <div className="insights-tiles" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)', marginBottom: 'var(--space-5)',
        }}>
          <StatTile
            label="Median LP build time"
            value={fmtDays(data.capacity.median_in_progress_days_lp)}
            hint="Median days a landing page spends In Progress"
          />
          <StatTile
            label="Median creative build time"
            value={fmtDays(data.capacity.median_in_progress_days_creative)}
            hint="Median days a creative batch spends In Progress"
          />
          <StatTile
            label="Shipped to review"
            value={String(data.capacity.throughput_week_total)}
            hint="Tracks reaching Internal Review in the last 7 days"
          />
        </div>

        <div className="insights-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 'var(--space-5)',
        }}>
          <BarPanel
            title="Throughput by producer"
            subtitle="Tracks shipped to Internal Review · last 7 days"
            data={data.capacity.throughput_by_producer}
            colorVar="--viz-series"
            unit="track"
          />
          <BarPanel
            title="Queue depth by producer"
            subtitle="Assigned tracks still sitting in Brief"
            data={data.capacity.queue_depth_by_producer}
            colorVar="--viz-series"
            unit="track"
          />
          <BarPanel
            title="Utilization by producer"
            subtitle="Share of the last 7 working days spent In Progress"
            data={data.capacity.utilization_by_producer}
            colorVar="--viz-series"
            unit="%"
            suffix="%"
            max={100}
          />
          <BarPanel
            title="Context-switch load"
            subtitle="Distinct brands touched per active day · last 7 days"
            data={data.capacity.context_switch_by_producer}
            colorVar="--viz-series"
            unit="brand/day"
            decimals={1}
          />
        </div>
      </section>

      {/* ── Dashboard 2: Slip Attribution ────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Slip Attribution"
          subtitle="Where time is lost — and the headline: how often a moment misses its month."
        />

        <div className="insights-tiles" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)', marginBottom: 'var(--space-5)',
        }}>
          <StatTile
            label="Rollover rate"
            value={data.slips.rollover_rate === null ? '—' : `${data.slips.rollover_rate}%`}
            hint="Moments that slipped into a later calendar month"
            tone={rolloverTone(data.slips.rollover_rate)}
          />
          <StatTile
            label="Median offer approval"
            value={fmtDays(data.slips.median_offer_approval_days)}
            hint={`Client Review → Approved · ${data.slips.approved_offers_measured} offer${data.slips.approved_offers_measured === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Projects evaluated"
            value={String(data.slips.evaluated_projects)}
            hint="Shipped or past-due cards with a known outcome"
          />
        </div>

        <div className="insights-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 'var(--space-5)',
        }}>
          <SlipHistogram buckets={data.slips.buckets} evaluated={data.slips.evaluated_projects} />
          <BarPanel
            title="Slip attribution by stage"
            subtitle="Which stage the card was sitting in when it slipped"
            data={data.slips.attribution_by_stage.map(d => ({ ...d, label: stageLabel(d.label) }))}
            colorVar="--viz-slip-3"
            unit="slip"
          />
          <BarPanel
            title="Slip by client"
            subtitle="Average days late · brands that drag most"
            data={data.slips.slip_by_brand}
            colorVar="--viz-slip-3"
            unit="day"
            decimals={1}
          />
          <BarPanel
            title="Slip by producer"
            subtitle="Average days late on overdue tracks"
            data={data.slips.slip_by_producer}
            colorVar="--viz-slip-3"
            unit="day"
            decimals={1}
          />
        </div>
      </section>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <h2 style={{
        fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text-primary)',
        letterSpacing: '-0.02em', marginBottom: 2,
      }}>
        {title}
      </h2>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{subtitle}</p>
    </div>
  )
}

function StatTile({
  label, value, hint, tone = 'default',
}: {
  label: string; value: string; hint: string; tone?: 'default' | 'warning' | 'critical'
}) {
  const valueColor =
    tone === 'critical' ? 'var(--danger)' :
    tone === 'warning' ? 'var(--warning)' :
    'var(--text-primary)'
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 'var(--space-4)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--text-2xl)', fontWeight: 700, color: valueColor,
        letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 4,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
        {hint}
      </div>
    </div>
  )
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px',
    }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
        {title}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 16 }}>
        {subtitle}
      </div>
      {children}
    </div>
  )
}

function EmptyChart() {
  return (
    <div style={{
      padding: '24px 8px', textAlign: 'center', color: 'var(--text-muted)',
      fontSize: 'var(--text-xs)', border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      No data in this window yet
    </div>
  )
}

// Horizontal bars: label left, value direct-labeled at the bar end. Single hue
// (identity is the row, not color), so no legend needed — the panel title names
// the measure.
function BarPanel({
  title, subtitle, data, colorVar, unit, suffix = '', max, decimals = 0,
}: {
  title: string; subtitle: string; data: BarDatum[]; colorVar: string
  unit: string; suffix?: string; max?: number; decimals?: number
}) {
  const peak = max ?? Math.max(1, ...data.map(d => d.value))
  return (
    <PanelShell title={title} subtitle={subtitle}>
      {data.length === 0 ? <EmptyChart /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map(d => {
            const pct = Math.max(2, (d.value / peak) * 100)
            const shown = `${d.value.toFixed(decimals)}${suffix}`
            return (
              <div key={d.label} title={`${d.label}: ${shown} ${pluralize(unit, d.value)}`}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 3, gap: 8,
                }}>
                  <span style={{
                    fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {d.label}
                  </span>
                  <span style={{
                    fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  }}>
                    {shown}
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: `var(${colorVar})`, borderRadius: 4,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PanelShell>
  )
}

// Slip histogram: five ordered buckets on-time → rolled-over. On-time uses
// status-green (with a check + label, never color alone); the four late
// buckets step the red ordinal ramp low→high severity.
function SlipHistogram({ buckets, evaluated }: { buckets: SlipBuckets; evaluated: number }) {
  const rows: Array<{ label: string; value: number; colorVar: string; icon?: string }> = [
    { label: 'On time', value: buckets.on_time, colorVar: '--viz-ontime', icon: '✓' },
    { label: '1–3 days late', value: buckets.d1_3, colorVar: '--viz-slip-1' },
    { label: '4–7 days late', value: buckets.d4_7, colorVar: '--viz-slip-2' },
    { label: '8+ days late', value: buckets.d8_plus, colorVar: '--viz-slip-3' },
    { label: 'Rolled over', value: buckets.rolled_over, colorVar: '--viz-slip-4' },
  ]
  const peak = Math.max(1, ...rows.map(r => r.value))
  return (
    <PanelShell
      title="Projects by slip"
      subtitle="Distribution of how late moments shipped"
    >
      {evaluated === 0 ? <EmptyChart /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => {
            const pct = r.value === 0 ? 0 : Math.max(3, (r.value / peak) * 100)
            return (
              <div key={r.label} title={`${r.label}: ${r.value} project${r.value === 1 ? '' : 's'}`}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 3, gap: 8,
                }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    {r.icon && <span style={{ color: `var(${r.colorVar})`, marginRight: 4 }}>{r.icon}</span>}
                    {r.label}
                  </span>
                  <span style={{
                    fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {r.value}
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: `var(${r.colorVar})`, borderRadius: 4,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PanelShell>
  )
}

function fmtDays(n: number | null): string {
  if (n === null) return '—'
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}d`
}

function rolloverTone(rate: number | null): 'default' | 'warning' | 'critical' {
  if (rate === null) return 'default'
  if (rate >= 25) return 'critical'
  if (rate >= 10) return 'warning'
  return 'default'
}

function pluralize(unit: string, n: number): string {
  if (unit.includes('/') || unit === '%') return unit
  return n === 1 ? unit : `${unit}s`
}

const STAGE_LABELS: Record<string, string> = {
  brief: 'Brief',
  in_progress: 'In Progress',
  internal_review: 'Internal Review',
  client_review: 'Client Review',
  revisions: 'Revisions',
  live: 'Live',
  // 'done' is retired as a stage, but pipeline_events is append-only and still
  // holds historical to_stage='done' rows. Keep the label so past cycles read
  // correctly in the charts instead of falling through to the raw key.
  done: 'Done (retired)',
}
function stageLabel(key: string): string {
  return STAGE_LABELS[key] ?? key
}
