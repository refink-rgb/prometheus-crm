import Link from 'next/link'
import { linkCampaign, endCampaignTracking, resumeCampaignTracking, unlinkCampaign } from '@/lib/results-actions'
import SubmitButton from '@/components/SubmitButton'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import { daysLive, shortDateLabel, type TrackedCampaign } from '@/lib/results'

// The manual campaign→moment link, on the project page. ~10 seconds per moment,
// and it is the ONLY way a campaign enters the Results tab — /api/results/ingest
// rejects any campaign that wasn't linked here.
//
// Server component: the forms post straight to server actions, no client state.

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

export default function CampaignTrackingPanel({
  projectId,
  brandId,
  campaigns,
  todayIso,
  canEdit,
}: {
  projectId: string
  brandId: string
  campaigns: TrackedCampaign[]
  todayIso: string
  canEdit: boolean
}) {
  return (
    <div className="card">
      <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)', color: 'var(--text-primary)' }}>
        Campaign Tracking
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
        Link the Meta campaign running for this moment and its daily results appear on{' '}
        <Link href="/results" style={{ color: 'var(--accent)' }}>Results</Link>. Nothing is
        auto-discovered — a campaign is only pulled once it is linked here.
      </p>

      {campaigns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          {campaigns.map(c => {
            const live = c.ended_on === null
            return (
              <div
                key={c.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  background: 'var(--surface-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <Link
                      href={`/results/${c.id}`}
                      style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      {c.campaign_name}
                    </Link>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'monospace' }}>
                      {c.meta_ad_account_id} · {c.meta_campaign_id}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      Launched {shortDateLabel(c.launched_on)} ·{' '}
                      {live
                        ? `${daysLive(c.launched_on, null, todayIso)} days live`
                        : `ended ${shortDateLabel(c.ended_on as string)} · ${daysLive(c.launched_on, c.ended_on, todayIso)} days tracked`}
                    </div>
                  </div>
                  <span className={live ? 'badge badge-live' : 'badge badge-upcoming'}>
                    {live ? 'Tracking' : 'Ended'}
                  </span>
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                    {live ? (
                      // Stops the agent fetching new days. Every stored day
                      // survives — this is the normal way a campaign retires.
                      <form action={endCampaignTracking.bind(null, c.id, projectId, brandId)}>
                        <SubmitButton className="btn-secondary btn-sm" pendingText="Ending…">
                          End tracking
                        </SubmitButton>
                      </form>
                    ) : (
                      <form action={resumeCampaignTracking.bind(null, c.id, projectId, brandId)}>
                        <SubmitButton className="btn-secondary btn-sm" pendingText="Resuming…">
                          Resume tracking
                        </SubmitButton>
                      </form>
                    )}
                    {/* Destructive: cascades to every daily row. For a campaign
                        that actually ran, "End tracking" is the right control —
                        the history is the whole point of the feature. */}
                    <ConfirmDeleteForm
                      action={unlinkCampaign.bind(null, c.id, projectId, brandId)}
                      message={`Unlink "${c.campaign_name}"? This permanently deletes every stored daily result for it. If the campaign really ran, use "End tracking" instead — that keeps the history.`}
                    >
                      <SubmitButton className="btn-danger btn-sm" pendingText="Removing…">
                        Unlink
                      </SubmitButton>
                    </ConfirmDeleteForm>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canEdit ? (
        <form action={linkCampaign} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="brand_id" value={brandId} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
            <div>
              <label style={LABEL_STYLE} htmlFor="meta_ad_account_id">Ad account ID</label>
              <input
                id="meta_ad_account_id"
                name="meta_ad_account_id"
                placeholder="act_1234567890"
                required
                style={INPUT_STYLE}
              />
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor="meta_campaign_id">Campaign ID</label>
              <input
                id="meta_campaign_id"
                name="meta_campaign_id"
                placeholder="23851234567890123"
                required
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div>
            <label style={LABEL_STYLE} htmlFor="campaign_name">Campaign name</label>
            <input
              id="campaign_name"
              name="campaign_name"
              placeholder="As it reads in Ads Manager"
              required
              style={INPUT_STYLE}
            />
            {/* Snapshot, not a live mirror: Meta campaign names get edited
                mid-flight and the Results tab should keep showing what we
                linked. */}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Stored as a snapshot — later renames in Ads Manager won&apos;t change it here.
            </div>
          </div>

          <div style={{ maxWidth: 220 }}>
            <label style={LABEL_STYLE} htmlFor="launched_on">Launch date</label>
            <input
              id="launched_on"
              name="launched_on"
              type="date"
              max={todayIso}
              required
              style={INPUT_STYLE}
            />
            {/* The "from" date for the whole daily table — the agent's first
                pull covers launch → yesterday. */}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Results are pulled from this date forward.
            </div>
          </div>

          <div>
            <SubmitButton className="btn-primary btn-sm" pendingText="Linking…">
              Link campaign
            </SubmitButton>
          </div>
        </form>
      ) : (
        campaigns.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No campaign linked yet.
          </div>
        )
      )}
    </div>
  )
}
