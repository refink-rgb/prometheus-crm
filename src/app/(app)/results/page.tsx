import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import FreshnessStamp from '@/components/FreshnessStamp'
import ResultsSparkline from '@/components/ResultsSparkline'
import { fetchDailyResults } from '@/lib/results-queries'
import {
  sumResults,
  cumulativeSeries,
  sortByDate,
  daysLive,
  missingDates,
  formatCents,
  formatCentsCompact,
  formatRoas,
  formatCount,
  shortDateLabel,
  trackedLabel,
  trackedSublabel,
  formatPercent,
  contributionMargin,
  breakEvenRoas,
  type BrandCod,
  type DailyResult,
  type TrackedCampaign,
} from '@/lib/results'

// Reads every live campaign's full daily history and aggregates in JS. Small
// data (campaigns × days), but give it headroom over the default so a cold
// read never trips the function timeout — same reasoning as /insights.
export const maxDuration = 60

interface CampaignRow extends TrackedCampaign {
  projects: { id: string; name: string } | null
  brands: ({ id: string; name: string } & BrandCod) | null
}

export default async function ResultsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  // Operational view over client performance — same bar as /insights.
  if (!canEdit(user.email)) redirect('/')

  const today = easternToday()

  const { data: campaignsRaw, error: campaignErr } = await supabase
    .from('tracked_campaigns')
    .select('id, project_id, brand_id, meta_ad_account_id, meta_campaign_id, campaign_name, meta_adset_id, adset_name, launched_on, ended_on, created_at, projects(id, name), brands(id, name, cod_value, cod_mode)')
    .is('ended_on', null)
    .order('launched_on', { ascending: false })

  // 42P01 = table doesn't exist. The migration is hand-run in the Supabase SQL
  // editor (repo convention, PROJECT_CONTEXT.md), so say that plainly instead
  // of rendering a broken page or a misleading "no campaigns yet".
  if (campaignErr?.code === '42P01') {
    return <SetupNotice />
  }

  const campaigns = (campaignsRaw ?? []) as unknown as CampaignRow[]

  // Paged — see fetchDailyResults. A truncated read here would understate
  // every tile on the page without any visible sign.
  const { rows: daily } = await fetchDailyResults(supabase, campaigns.map(c => c.id))

  const byCampaign = new Map<string, DailyResult[]>()
  for (const row of daily) {
    const list = byCampaign.get(row.tracked_campaign_id)
    if (list) list.push(row)
    else byCampaign.set(row.tracked_campaign_id, [row])
  }

  // Header tiles span every live campaign. Ratios come from summed cents, not
  // from averaging per-campaign ratios — see sumResults.
  const overall = sumResults(daily)

  // Portfolio contribution margin. Summed PER CAMPAIGN because COD is a brand
  // property — one blended rate across brands would be meaningless. Campaigns
  // whose brand has no COD set are excluded and counted, so a partial figure
  // never passes for a complete one.
  let cmTotal: number | null = null
  let cmMissing = 0
  for (const c of campaigns) {
    const rows = byCampaign.get(c.id) ?? []
    if (rows.length === 0) continue
    const t = sumResults(rows)
    const m = contributionMargin(codOf(c), t.revenue_cents, t.spend_cents, t.purchases)
    if (m.cm_cents === null) { cmMissing++; continue }
    cmTotal = (cmTotal ?? 0) + m.cm_cents
  }
  // Read once per request and threaded down, so every card's freshness is
  // measured against the same instant. (`new Date()` rather than `Date.now()`
  // — the react-hooks/purity rule flags the latter inside a component, and
  // calendar/timeline already read the clock this way.)
  const nowMs = new Date().getTime()

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
          Results
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {campaigns.length === 0
            ? 'Live campaigns, one row per day, refreshed daily.'
            : `${campaigns.length} live campaign${campaigns.length === 1 ? '' : 's'} · ${overall.days} campaign-day${overall.days === 1 ? '' : 's'} recorded · pulled at the 7-day-click attribution window`}
        </p>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-8)',
          }}>
            <Tile label="Spend" value={formatCents(overall.spend_cents)} hint="All live campaigns, since launch" />
            <Tile label="Revenue" value={formatCents(overall.revenue_cents)} hint="Total attributed revenue" />
            <Tile label="ROAS" value={formatRoas(overall.roas)} hint="Revenue ÷ spend, weighted by spend" />
            <Tile label="Purchases" value={formatCount(overall.purchases)} hint="Attributed purchases" />
            <Tile
              label="Incremental revenue"
              value={formatCents(overall.incremental_revenue_cents)}
              hint={overall.incremental_revenue_cents === null
                ? 'No account reports this column'
                : 'As reported by the ad account'}
            />
            <Tile
              label="Contribution margin"
              value={formatCents(cmTotal)}
              hint={cmTotal === null
                ? 'No brand has a cost of delivery set'
                : cmMissing > 0
                  ? `${cmMissing} campaign${cmMissing === 1 ? '' : 's'} excluded — no COD set`
                  : 'Revenue − delivery − spend'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {campaigns.map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                rows={byCampaign.get(c.id) ?? []}
                todayIso={today}
                nowMs={nowMs}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CampaignCard({
  campaign,
  rows,
  todayIso,
  nowMs,
}: {
  campaign: CampaignRow
  rows: DailyResult[]
  todayIso: string
  nowMs: number
}) {
  const ordered = sortByDate(rows)
  const totals = sumResults(ordered)
  const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null
  const live = daysLive(campaign.launched_on, campaign.ended_on, todayIso)
  const series = cumulativeSeries(ordered)

  // The agent stops at yesterday, so the expected window ends there. A gap
  // here is normal under restatement lag; a growing one is a broken agent.
  const gaps = missingDates(ordered, campaign.launched_on, previousDay(todayIso))
  const flagged = ordered.filter(r => r.warnings.length > 0).length
  const margin = contributionMargin(codOf(campaign), totals.revenue_cents, totals.spend_cents, totals.purchases)
  const be = breakEvenRoas(codOf(campaign))

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
            {campaign.brands?.name ?? 'Unknown brand'}
            {campaign.projects?.name ? ` · ${campaign.projects.name}` : ''}
          </div>
          <Link
            href={`/results/${campaign.id}`}
            style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {trackedLabel(campaign)}
          </Link>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {/* Says "ad set in <campaign>" when tracking is narrowed, so nobody
                reads these numbers as the whole campaign's. */}
            {trackedSublabel(campaign) && <>{trackedSublabel(campaign)} · </>}
            Launched {shortDateLabel(campaign.launched_on)} · day {live}
          </div>
        </div>

        <FreshnessStamp rows={ordered} nowMs={nowMs} />
      </div>

      {ordered.length === 0 ? (
        <div style={{
          marginTop: 'var(--space-4)',
          padding: '14px 16px',
          border: '1px dashed var(--border-strong)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}>
          No results pulled yet. The scheduled agent picks this campaign up on its next run
          (~7am Eastern) and backfills from {shortDateLabel(campaign.launched_on)}.
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--border)',
          }}>
            <MiniStat label="Spend" sub="since launch" value={formatCents(totals.spend_cents)} />
            <MiniStat label="Revenue" sub="since launch" value={formatCents(totals.revenue_cents)} />
            <MiniStat label="ROAS" sub="since launch" value={formatRoas(totals.roas)} />
            <MiniStat label="Purchases" sub="since launch" value={formatCount(totals.purchases)} />
            <MiniStat
              label="Contrib. margin"
              sub={margin.cm_pct === null ? 'no COD set' : `${formatPercent(margin.cm_pct, 1)} of revenue`}
              value={formatCents(margin.cm_cents)}
            />
            <MiniStat
              label="Latest day"
              sub={latest ? shortDateLabel(latest.stat_date) : '—'}
              value={latest ? `${formatCentsCompact(latest.revenue_cents)} · ${formatRoas(latest.roas)}` : '—'}
            />
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <ResultsSparkline points={series} />
          </div>

          {/* Below break-even is the one state worth interrupting for: every
              other badge is about data quality, this one is about money. */}
          {be !== null && totals.roas !== null && totals.roas < be && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <span className="badge badge-overdue" title={`Break-even ROAS is ${formatRoas(be)} at this brand's cost of delivery.`}>
                below break-even ({formatRoas(totals.roas)} vs {formatRoas(be)})
              </span>
            </div>
          )}

          {(gaps.length > 0 || flagged > 0) && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
              {/* A gap is shown rather than smoothed over: a missing day and a
                  zero day are different facts, and the chart can't say which. */}
              {gaps.length > 0 && (
                <span className="badge badge-upcoming" title={gaps.slice(0, 10).map(shortDateLabel).join(', ')}>
                  {gaps.length} day{gaps.length === 1 ? '' : 's'} missing
                </span>
              )}
              {flagged > 0 && (
                <span className="badge badge-due">
                  {flagged} day{flagged === 1 ? '' : 's'} flagged
                </span>
              )}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Link href={`/results/${campaign.id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
          Daily breakdown →
        </Link>
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{hint}</div>
    </div>
  )
}

function MiniStat({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px dashed var(--border-strong)',
      borderRadius: 12,
      padding: '24px 28px',
      color: 'var(--text-muted)',
      fontSize: 13,
      lineHeight: 1.7,
      maxWidth: 640,
    }}>
      <strong style={{ color: 'var(--text-primary)' }}>No campaigns are being tracked yet.</strong>
      <p style={{ marginTop: 8 }}>
        Open a project and use the <strong>Campaign Tracking</strong> panel to link its Meta
        campaign — ad account ID, campaign ID, and launch date. Nothing is auto-discovered:
        the link is the contract, and the ingest endpoint rejects any campaign that
        hasn&apos;t been linked here.
      </p>
      <p style={{ marginTop: 8 }}>
        Once linked, the scheduled agent picks it up on its next run and backfills from the
        launch date.
      </p>
    </div>
  )
}

function SetupNotice() {
  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
        Results
      </h1>
      <div style={{
        background: 'var(--surface-1)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 12,
        padding: '24px 28px',
        color: 'var(--text-muted)',
        fontSize: 13,
        lineHeight: 1.7,
        maxWidth: 640,
      }}>
        <strong style={{ color: 'var(--text-primary)' }}>The results tables don&apos;t exist yet.</strong>
        <p style={{ marginTop: 8 }}>
          Run <code style={{ fontFamily: 'monospace', fontSize: 12 }}>supabase/migrations/20260805_add_campaign_results.sql</code>{' '}
          in the Supabase SQL editor, then reload. Migrations in this repo are applied by
          hand, so this page can appear before its schema does.
        </p>
      </div>
    </div>
  )
}

// COD lives on the brand; a campaign whose brand join failed has none, which
// renders as an em dash rather than as free delivery.
function codOf(campaign: CampaignRow): BrandCod {
  return campaign.brands
    ? { cod_value: campaign.brands.cod_value, cod_mode: campaign.brands.cod_mode }
    : { cod_value: null, cod_mode: 'percent' }
}

function previousDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}
