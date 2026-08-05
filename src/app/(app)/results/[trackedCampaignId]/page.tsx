import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import FreshnessStamp from '@/components/FreshnessStamp'
import CampaignDailyCharts from '@/components/CampaignDailyCharts'
import DailyResultsTable from '@/components/DailyResultsTable'
import { fetchDailyResults } from '@/lib/results-queries'
import BrandCodEditor from '@/components/BrandCodEditor'
import {
  sumResults,
  cumulativeSeries,
  sortByDate,
  daysLive,
  missingDates,
  formatCents,
  formatRoas,
  formatCount,
  formatPercent,
  shortDateLabel,
  trackedLabel,
  trackedSublabel,
  safeRate,
  contributionMargin,
  breakEvenRoas,
  type BrandCod,
  type TrackedCampaign,
} from '@/lib/results'

export const maxDuration = 60

interface CampaignRow extends TrackedCampaign {
  projects: { id: string; name: string } | null
  brands: ({ id: string; name: string } & BrandCod) | null
}

// The literal ask: every campaign we launched, one row per day, from launch
// through the last update, with all eight metrics.
export default async function CampaignResultsPage({
  params,
}: {
  params: Promise<{ trackedCampaignId: string }>
}) {
  const { trackedCampaignId } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canEdit(user.email)) redirect('/')

  const today = easternToday()

  const { data: campaignRaw } = await supabase
    .from('tracked_campaigns')
    .select('id, project_id, brand_id, meta_ad_account_id, meta_campaign_id, campaign_name, meta_adset_id, adset_name, launched_on, ended_on, created_at, projects(id, name), brands(id, name, cod_value, cod_mode)')
    .eq('id', trackedCampaignId)
    .single()

  if (!campaignRaw) notFound()
  const campaign = campaignRaw as unknown as CampaignRow

  // Paged — a long-running campaign can exceed a single result set, and a
  // truncated daily table would silently drop days from the middle of the run.
  const { rows: dailyRows } = await fetchDailyResults(supabase, [trackedCampaignId])

  // `new Date()` rather than `Date.now()` — the react-hooks/purity rule flags
  // the latter inside a component.
  const nowMs = new Date().getTime()
  const rows = sortByDate(dailyRows)
  const totals = sumResults(rows)
  const series = cumulativeSeries(rows)
  const live = daysLive(campaign.launched_on, campaign.ended_on, today)
  // The agent stops at yesterday — today is still accruing.
  const gaps = missingDates(rows, campaign.launched_on, previousDay(today))
  const flagged = rows.filter(r => r.warnings.length > 0)
  const manualCount = rows.filter(r => r.source === 'manual').length

  // Cumulative LP conversion across the run, derived from the stored
  // denominators rather than averaging the daily rates.
  const overallLpConv = totals.landing_page_views === null
    ? null
    : safeRate(totals.purchases, totals.landing_page_views)

  // Contribution margin is DERIVED AT RENDER from the brand's current COD, not
  // stored on the daily rows. Correcting a brand's COD therefore fixes every
  // historical day at once, instead of leaving months of rows computed against
  // a number nobody remembers setting.
  const cod: BrandCod = campaign.brands
    ? { cod_value: campaign.brands.cod_value, cod_mode: campaign.brands.cod_mode }
    : { cod_value: null, cod_mode: 'percent' }
  const margin = contributionMargin(cod, totals.revenue_cents, totals.spend_cents, totals.purchases)
  const be = breakEvenRoas(cod)

  return (
    <div style={{ padding: 'var(--space-6) 32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <Link href="/results" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>← Results</Link>
        {campaign.brands && (
          <>
            <span style={{ opacity: 0.5 }}>/</span>
            <Link href={`/brands/${campaign.brand_id}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
              {campaign.brands.name}
            </Link>
          </>
        )}
        {campaign.projects && (
          <>
            <span style={{ opacity: 0.5 }}>/</span>
            <Link
              href={`/brands/${campaign.brand_id}/projects/${campaign.project_id}`}
              style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
            >
              {campaign.projects.name}
            </Link>
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            {trackedLabel(campaign)}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {/* Ad-set-level tracking is stated up front. These numbers are one
                ad set's, not the parent campaign's, and the page must say so
                before anyone quotes a figure off it. */}
            {trackedSublabel(campaign) && <>{trackedSublabel(campaign)}<br /></>}
            <span style={{ fontFamily: 'monospace' }}>
              {campaign.meta_ad_account_id} · {campaign.meta_campaign_id}
              {campaign.meta_adset_id && ` · ${campaign.meta_adset_id}`}
            </span>
            <br />
            Launched {shortDateLabel(campaign.launched_on)} · day {live}
            {campaign.ended_on && ` · tracking ended ${shortDateLabel(campaign.ended_on)}`}
            {rows.length > 0 && ` · ${rows[0].attribution_window} attribution`}
          </div>
        </div>
        <FreshnessStamp rows={rows} nowMs={nowMs} />
      </div>

      {rows.length === 0 ? (
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
          <strong style={{ color: 'var(--text-primary)' }}>No results pulled yet.</strong>
          <p style={{ marginTop: 8 }}>
            The scheduled agent picks this campaign up on its next run (~7am Eastern) and
            backfills from {shortDateLabel(campaign.launched_on)} through yesterday.
          </p>
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
          }}>
            <Tile label="Spend" value={formatCents(totals.spend_cents)} sub="since launch" />
            <Tile label="Revenue" value={formatCents(totals.revenue_cents)} sub="since launch" />
            <Tile label="ROAS" value={formatRoas(totals.roas)} sub="spend-weighted" />
            <Tile label="Purchases" value={formatCount(totals.purchases)} sub="since launch" />
            <Tile label="CPA" value={formatCents(totals.cpa_cents)} sub="spend ÷ purchases" />
            <Tile
              label="Incremental revenue"
              value={formatCents(totals.incremental_revenue_cents)}
              sub={totals.incremental_revenue_cents === null ? 'not reported' : 'as reported'}
            />
            <Tile label="LP conversion" value={formatPercent(overallLpConv)} sub="purchases ÷ LP views" />
            <Tile label="Days recorded" value={formatCount(totals.days)} sub={`of ${live} live`} />
            {/* Margin tiles sit with the rest rather than in their own block:
                ROAS without CM beside it is what makes a losing campaign look
                like a winning one. */}
            <Tile
              label="Contribution margin"
              value={formatCents(margin.cm_cents)}
              sub={margin.cm_cents === null ? 'set a COD below' : 'revenue − delivery − spend'}
            />
            <Tile
              label="CM %"
              value={formatPercent(margin.cm_pct)}
              sub={margin.cm_pct === null ? 'set a COD below' : 'of revenue'}
            />
          </div>

          {/* Break-even is the single most actionable number once a COD is
              set: it turns "is 2.1x good?" into a yes or no. */}
          {be !== null && totals.roas !== null && (
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <Notice tone={totals.roas >= be ? 'muted' : 'warn'}>
                Break-even ROAS for {campaign.brands?.name ?? 'this brand'} is{' '}
                <strong>{formatRoas(be)}</strong>. This campaign is running at{' '}
                <strong>{formatRoas(totals.roas)}</strong> —{' '}
                {totals.roas >= be ? 'above break-even, so it is contributing margin.' : 'below break-even, so it is losing money on every order.'}
              </Notice>
            </div>
          )}

          {(gaps.length > 0 || flagged.length > 0 || manualCount > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
              {gaps.length > 0 && (
                <Notice tone="muted">
                  <strong>{gaps.length} day{gaps.length === 1 ? '' : 's'} missing</strong> between launch and
                  yesterday: {gaps.slice(0, 12).map(shortDateLabel).join(', ')}
                  {gaps.length > 12 && ` and ${gaps.length - 12} more`}. A short lag is normal — Meta
                  restates for days after the fact. A gap that keeps growing means the agent isn&apos;t running.
                </Notice>
              )}
              {flagged.length > 0 && (
                <Notice tone="warn">
                  <strong>{flagged.length} day{flagged.length === 1 ? '' : 's'} flagged</strong> by validation —
                  the row was stored, not dropped, and is badged in the table below. A flag means the
                  numbers disagree with each other, not that they&apos;re definitely wrong.
                </Notice>
              )}
              {manualCount > 0 && (
                <Notice tone="muted">
                  <strong>{manualCount} day{manualCount === 1 ? '' : 's'} manually corrected.</strong> The agent
                  will not overwrite these on future runs.
                </Notice>
              )}
            </div>
          )}

          <div style={{ marginBottom: 'var(--space-8)' }}>
            <CampaignDailyCharts points={series} />
          </div>

          {campaign.brands && (
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <BrandCodEditor
                brandId={campaign.brands.id}
                brandName={campaign.brands.name}
                cod={cod}
                canEdit={canEdit(user.email)}
              />
            </div>
          )}

          <DailyResultsTable
            rows={rows}
            trackedCampaignId={campaign.id}
            canEdit={canEdit(user.email)}
          />
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '13px 15px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'muted'; children: React.ReactNode }) {
  const warn = tone === 'warn'
  return (
    <div style={{
      background: warn ? 'rgba(234,179,8,0.08)' : 'var(--surface-1)',
      border: `1px solid ${warn ? 'rgba(234,179,8,0.28)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

function previousDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}
