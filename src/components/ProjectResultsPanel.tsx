'use client'

// The per-project Results tab: LP-scoped ad performance vs the rest of the ad
// account. See 20260915_add_lp_results.sql for the data model and
// RESULTS_AGENT_PROMPT.md for how the numbers arrive.
//
// Three sections:
//   1. KPI tiles — the mockup's grid: Spend / ROAS / CPM / AOV / CVR / CTR /
//      click-to-checkout / checkout conversion, each compared against the
//      REST of the account (account totals minus this LP's ads).
//   2. Spend + ROAS by day — Recharts, same tokens as CampaignDailyCharts.
//   3. Matched ads — the suggest-and-confirm surface. Every ad the agent
//      matched (campaign + ad set names included, so a human can judge the
//      match by where the ad lives), with exclude/include and a manual add.
//
// Every KPI is DERIVED from summed raw counts in src/lib/results.ts — nothing
// on this panel is an agent-reported ratio.

import { useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  startLpTracking, endLpTracking, resumeLpTracking, unlinkLpTracking,
  setAdMatchStatus, addManualAdMatch, setResultsClientVisible, refreshResultsFromMeta,
} from '@/lib/results-actions'
import SubmitButton from '@/components/SubmitButton'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import FreshnessStamp from '@/components/FreshnessStamp'
import {
  sumFunnel, deriveFunnelKpis, restOfAccount, shareOfAccountPct, safeRoas,
  formatCents, formatCentsCompact, formatPercent, formatRoas,
  dayOverDayPct, shortDateLabel, daysLive,
  type LpTracking, type LpAdMatch, type FunnelDailyRow, type FunnelKpis,
} from '@/lib/results'

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 'var(--space-1)',
  display: 'block',
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
}

export default function ProjectResultsPanel({
  projectId,
  brandId,
  projectLpUrl,
  resultsClientVisible,
  canEdit,
  tracking,
  matches,
  lpDaily,
  accountDaily,
  todayIso,
  nowMs,
  knownAdAccounts,
  brandAdAccount,
}: {
  projectId: string
  brandId: string
  projectLpUrl: string | null
  resultsClientVisible: boolean
  canEdit: boolean
  tracking: LpTracking | null
  matches: LpAdMatch[]
  lpDaily: FunnelDailyRow[]
  accountDaily: FunnelDailyRow[]
  todayIso: string
  nowMs: number
  /** Ad accounts already used by this brand's campaign tracking — fallback options. */
  knownAdAccounts: string[]
  /** brands.meta_ad_account_id — the preferred, brand-managed option. */
  brandAdAccount: string | null
}) {
  // ── No tracking yet: the opt-in form ────────────────────────────────────
  if (!tracking) {
    // The brand's own account first, then anything campaign tracking has
    // already used. Usually one entry — the select is confirmation, not work.
    const accountOptions = [...new Set([brandAdAccount, ...knownAdAccounts].filter((a): a is string => !!a))]
    return (
      <section className="card" style={{ padding: '20px 22px' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          Track this landing page&apos;s ad performance
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 620, marginBottom: 'var(--space-4)' }}>
          The nightly agent will find every ad in the account whose destination is this landing
          page, pull their daily results, and compare them against the rest of the ad account.
          Matched ads appear below for review — you can exclude any of them, or add one the
          discovery missed.
        </p>
        {canEdit ? (
          <form action={startLpTracking} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 460 }}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="brand_id" value={brandId} />
            <div>
              <label style={LABEL_STYLE} htmlFor="lp_meta_ad_account_id">Ad account</label>
              {accountOptions.length > 0 ? (
                <>
                  <select
                    id="lp_meta_ad_account_id"
                    name="meta_ad_account_id"
                    defaultValue={accountOptions[0]}
                    required
                    style={{ ...INPUT_STYLE, maxWidth: 260 }}
                  >
                    {accountOptions.map(a => (
                      <option key={a} value={a}>{a}{a === brandAdAccount ? ' (brand default)' : ''}</option>
                    ))}
                  </select>
                  <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    Managed on the brand page (Account Details).
                  </span>
                </>
              ) : (
                <>
                  <input
                    id="lp_meta_ad_account_id"
                    name="meta_ad_account_id"
                    placeholder="act_10035647"
                    required
                    style={{ ...INPUT_STYLE, maxWidth: 260 }}
                  />
                  <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    Tip: set the Meta Ad Account ID once on the brand page (Account Details) and
                    this becomes a dropdown.
                  </span>
                </>
              )}
            </div>
            {projectLpUrl ? (
              // The project already knows its LP URL — no retyping. Hidden
              // input + read-only display; the snapshot rule still applies.
              <div>
                <label style={LABEL_STYLE}>Landing page URL</label>
                <input type="hidden" name="lp_url" value={projectLpUrl} />
                <div style={{ ...INPUT_STYLE, background: 'var(--surface-raised)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                  {projectLpUrl}
                </div>
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                  From the project&apos;s Final output. Ads are matched on this URL (UTM parameters
                  and http/https ignored); snapshotted at start — if the page moves, restart tracking.
                </span>
              </div>
            ) : (
              <div>
                <label style={LABEL_STYLE} htmlFor="lp_url">Landing page URL</label>
                <input
                  id="lp_url"
                  name="lp_url"
                  placeholder="https://brand.com/pages/offer"
                  required
                  style={INPUT_STYLE}
                />
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                  This project has no LP URL yet — set it on the Landing Page tab and it will
                  prefill here. Ads are matched on this URL (UTM parameters and http/https ignored).
                </span>
              </div>
            )}
            <div>
              <label style={LABEL_STYLE} htmlFor="lp_launched_on">Launch date (optional)</label>
              <input
                id="lp_launched_on"
                name="launched_on"
                type="date"
                max={todayIso}
                style={{ ...INPUT_STYLE, maxWidth: 200 }}
              />
              <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                Leave blank and the nightly agent detects it — the first day any of this page&apos;s
                ads delivered.
              </span>
            </div>
            <div>
              <SubmitButton className="btn-primary btn-sm" pendingText="Starting…">
                Start tracking
              </SubmitButton>
            </div>
          </form>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>An editor can start tracking here.</p>
        )}
      </section>
    )
  }

  return (
    <TrackingView
      projectId={projectId}
      brandId={brandId}
      resultsClientVisible={resultsClientVisible}
      canEdit={canEdit}
      tracking={tracking}
      matches={matches}
      lpDaily={lpDaily}
      accountDaily={accountDaily}
      todayIso={todayIso}
      nowMs={nowMs}
    />
  )
}

function TrackingView({
  projectId,
  brandId,
  resultsClientVisible,
  canEdit,
  tracking,
  matches,
  lpDaily,
  accountDaily,
  todayIso,
  nowMs,
}: {
  projectId: string
  brandId: string
  resultsClientVisible: boolean
  canEdit: boolean
  tracking: LpTracking
  matches: LpAdMatch[]
  lpDaily: FunnelDailyRow[]
  accountDaily: FunnelDailyRow[]
  todayIso: string
  nowMs: number
}) {
  const live = tracking.ended_on === null

  const { lpTotals, lpKpis, rest, restKpis, sharePct, chartData, warningDays } = useMemo(() => {
    const lpTotals = sumFunnel(lpDaily)
    const accountTotals = sumFunnel(accountDaily)
    const rest = restOfAccount(accountTotals, lpTotals)
    const sorted = [...lpDaily].sort((a, b) => a.stat_date.localeCompare(b.stat_date))
    return {
      lpTotals,
      lpKpis: deriveFunnelKpis(lpTotals),
      rest,
      restKpis: deriveFunnelKpis(rest.totals),
      sharePct: shareOfAccountPct(lpTotals.spend_cents, accountTotals.spend_cents),
      chartData: sorted.map(r => ({
        label: shortDateLabel(r.stat_date),
        spend: r.spend_cents / 100,
        roas: safeRoas(r.revenue_cents, r.spend_cents),
      })),
      warningDays: lpDaily.filter(r => r.warnings.length > 0).length,
    }
  }, [lpDaily, accountDaily])

  const included = matches.filter(m => m.status === 'included')
  const excluded = matches.filter(m => m.status === 'excluded')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* ── Header: status, freshness, push-to-client ────────────────────── */}
      <section className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={live ? 'badge badge-done' : 'badge'}>
              {live ? '● Tracking live' : 'Tracking ended'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {tracking.meta_ad_account_id}
              {tracking.launched_on
                ? ` · day ${daysLive(tracking.launched_on, tracking.ended_on, todayIso)}`
                : ' · launch date: detecting from the ads’ first delivery'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
            {tracking.lp_url}
          </div>
        </div>
        <FreshnessStamp rows={lpDaily} nowMs={nowMs} />
        {canEdit && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {/* On-demand engine run for this brand — same code path as the
                nightly cron, so being one day behind is a choice, not a wait. */}
            <form action={refreshResultsFromMeta.bind(null, projectId, brandId)}>
              <SubmitButton className="btn-secondary btn-sm" pendingText="Pulling from Meta… (~30s)">
                ⟳ Refresh from Meta
              </SubmitButton>
            </form>
            {/* Push to client: internal-first, same contract as creative
                client_visible. The button is the ONLY thing that changes the
                client link. */}
            <form action={setResultsClientVisible.bind(null, projectId, brandId, !resultsClientVisible)}>
              <SubmitButton
                className={resultsClientVisible ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}
                pendingText={resultsClientVisible ? 'Hiding…' : 'Publishing…'}
              >
                {resultsClientVisible ? 'Hide from client link' : 'Push to client link'}
              </SubmitButton>
            </form>
            {live ? (
              <form action={endLpTracking.bind(null, tracking.id, projectId, brandId)}>
                <SubmitButton className="btn-secondary btn-sm" pendingText="Ending…">End tracking</SubmitButton>
              </form>
            ) : (
              <form action={resumeLpTracking.bind(null, tracking.id, projectId, brandId)}>
                <SubmitButton className="btn-secondary btn-sm" pendingText="Resuming…">Resume</SubmitButton>
              </form>
            )}
            <ConfirmDeleteForm
              action={unlinkLpTracking.bind(null, tracking.id, projectId, brandId)}
              message="Remove LP tracking? This permanently deletes every matched ad and every stored daily result for this page. If the campaign just finished, use End tracking instead — that keeps the history."
            >
              <SubmitButton className="btn-danger btn-sm" pendingText="Removing…">Remove</SubmitButton>
            </ConfirmDeleteForm>
          </div>
        )}
      </section>

      {resultsClientVisible && (
        <div style={{
          fontSize: 12, color: 'var(--success)',
          padding: '8px 12px', borderRadius: 8,
          background: 'color-mix(in srgb, var(--success) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)',
        }}>
          ✓ Visible on the client link — the client sees these tiles and charts on their review page.
        </div>
      )}

      {lpDaily.length === 0 ? (
        <section className="card" style={{ padding: '20px 22px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          {tracking.launched_on
            ? 'No daily results yet. The nightly agent discovers this page’s ads and pulls their daily numbers on its next run (~7am Eastern) — matched ads will appear below for review.'
            : 'No daily results yet. On its next run (~7am Eastern) the nightly agent finds this page’s ads and detects the launch date from their first day of delivery; the daily history backfills on the run after the date is set (or immediately, if the agent reports both in one run).'}
        </section>
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-3)' }}>
            <Tile
              label="Spend"
              value={formatCentsCompact(lpTotals.spend_cents)}
              sub={sharePct !== null ? `${formatPercent(sharePct, 1)} of total ad account spend` : 'account totals pending'}
            />
            <Tile
              label="ROAS"
              value={formatRoas(lpKpis.roas)}
              sub="Meta attributed, 7-day click"
            />
            <CompareTile label="CPM" lp={lpKpis} rest={restKpis} metric="cpm_cents" goodWhenHigher={false} format={v => formatCents(v)} />
            <CompareTile label="AOV" lp={lpKpis} rest={restKpis} metric="aov_cents" goodWhenHigher format={v => formatCents(v)} />
            <CompareTile label="CVR" lp={lpKpis} rest={restKpis} metric="cvr" goodWhenHigher format={v => formatPercent(v)} />
            <CompareTile label="CTR" lp={lpKpis} rest={restKpis} metric="ctr" goodWhenHigher format={v => formatPercent(v)} />
            <CompareTile label="Click-to-checkout rate" lp={lpKpis} rest={restKpis} metric="click_to_checkout" goodWhenHigher format={v => formatPercent(v, 1)} />
            <CompareTile label="Checkout conversion rate" lp={lpKpis} rest={restKpis} metric="checkout_cvr" goodWhenHigher format={v => formatPercent(v, 1)} />
          </div>

          {(rest.clamped.length > 0 || warningDays > 0) && (
            <div style={{ fontSize: 11, color: 'var(--warning)', lineHeight: 1.5 }}>
              {warningDays > 0 && <div>⚠ {warningDays} day{warningDays === 1 ? '' : 's'} carry validation warnings — cross-checks disagreed with the reported numbers.</div>}
              {rest.clamped.length > 0 && <div>⚠ Account totals briefly trail the LP&apos;s on: {rest.clamped.join(', ')} (restatement lag) — those rest-of-account figures are floored at 0.</div>}
            </div>
          )}

          {/* ── Spend + ROAS by day ────────────────────────────────────────── */}
          <section className="card" style={{ padding: '18px 20px' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              Spend vs. ROAS, day by day
            </h3>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              This landing page&apos;s ads only. Both panels share the same days.
            </p>
            <ChartPair data={chartData} />
          </section>
        </>
      )}

      {/* ── Matched ads ──────────────────────────────────────────────────── */}
      <section className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Matched ads
          </h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {included.length} included{excluded.length > 0 ? ` · ${excluded.length} excluded` : ''}
          </span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 640, marginBottom: 'var(--space-4)' }}>
          Every ad in {tracking.meta_ad_account_id} whose destination URL is this landing page.
          Discovered nightly; each match is URL-verified server-side before it lands here. Exclude
          anything that doesn&apos;t belong — exclusions stick across re-discovery — or add an ad
          the discovery missed.
        </p>

        {matches.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No ads matched yet — the agent proposes them on its next nightly run.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={TH}>Ad</th>
                  <th style={TH}>Campaign</th>
                  <th style={TH}>Ad set</th>
                  <th style={TH}>Status</th>
                  {canEdit && <th style={TH} />}
                </tr>
              </thead>
              <tbody>
                {[...included, ...excluded].map(m => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--border)', opacity: m.status === 'excluded' ? 0.55 : 1 }}>
                    <td style={TD}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.ad_name ?? m.meta_ad_id}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {m.meta_ad_id}{m.source === 'manual' ? ' · added manually' : ''}
                      </div>
                    </td>
                    <td style={TD}>{m.campaign_name ?? m.meta_campaign_id ?? '—'}</td>
                    <td style={TD}>{m.adset_name ?? m.meta_adset_id ?? '—'}</td>
                    <td style={TD}>
                      <span className={m.status === 'included' ? 'badge badge-done' : 'badge'}>
                        {m.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <form action={setAdMatchStatus.bind(null, m.id, m.status === 'included' ? 'excluded' : 'included', projectId, brandId)}>
                          <SubmitButton className="btn-secondary btn-sm" pendingText="Saving…">
                            {m.status === 'included' ? 'Exclude' : 'Include'}
                          </SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canEdit && (
          <form action={addManualAdMatch} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
            <input type="hidden" name="lp_tracking_id" value={tracking.id} />
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="brand_id" value={brandId} />
            <div>
              <label style={LABEL_STYLE} htmlFor="manual_ad_id">Add an ad by ID</label>
              <input id="manual_ad_id" name="meta_ad_id" placeholder="120210000000000000" required style={{ ...INPUT_STYLE, width: 220 }} />
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor="manual_ad_name">Name (optional)</label>
              <input id="manual_ad_name" name="ad_name" placeholder="Statics – hook 3" style={{ ...INPUT_STYLE, width: 220 }} />
            </div>
            <SubmitButton className="btn-secondary btn-sm" pendingText="Adding…">Add ad</SubmitButton>
          </form>
        )}
      </section>
    </div>
  )
}

const TH: React.CSSProperties = { padding: '6px 10px 6px 0', fontWeight: 600 }
const TD: React.CSSProperties = { padding: '9px 10px 9px 0', color: 'var(--text-secondary)', verticalAlign: 'top' }

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>
    </div>
  )
}

// A tile with the rest-of-account comparison line and a delta chip. The chip's
// color follows the metric's GOOD direction — a lower CPM is green, a lower
// CVR is red.
function CompareTile({
  label,
  lp,
  rest,
  metric,
  goodWhenHigher,
  format,
}: {
  label: string
  lp: FunnelKpis
  rest: FunnelKpis
  metric: keyof FunnelKpis
  goodWhenHigher: boolean
  format: (v: number | null) => string
}) {
  const lpVal = lp[metric]
  const restVal = rest[metric]
  const delta = lpVal !== null && restVal !== null ? dayOverDayPct(lpVal, restVal) : null
  const isGood = delta !== null && (goodWhenHigher ? delta >= 0 : delta <= 0)

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{format(lpVal)}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Rest of account <strong style={{ color: 'var(--text-secondary)' }}>{format(restVal)}</strong>
        </span>
        {delta !== null && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 12,
            color: isGood ? 'var(--success)' : 'var(--danger)',
            background: `color-mix(in srgb, ${isGood ? 'var(--success)' : 'var(--danger)'} 12%, transparent)`,
          }}>
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

interface ChartDatum {
  label: string
  spend: number
  roas: number | null
}

function ChartPair({ data }: { data: ChartDatum[] }) {
  const axisTick = { fill: 'var(--text-muted)', fontSize: 11 }
  const axisLine = { stroke: 'var(--border)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Spend <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>daily, USD</span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} width={52} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [formatCents(Math.round((v as number) * 100)), 'Spend']}
            />
            <Bar dataKey="spend" fill="var(--viz-series)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
          ROAS <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>7-day click</span>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}x`} width={52} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [formatRoas(v as number), 'ROAS']}
            />
            <Line dataKey="roas" stroke="var(--viz-ontime)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Reused by the client review section — the formatting must match what the
// internal tab shows, so the number the client quotes back is the number the
// team sees.
export { Tile as ResultsTile, CompareTile as ResultsCompareTile, ChartPair as ResultsChartPair }
