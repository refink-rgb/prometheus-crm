import Link from 'next/link'
import {
  linkCampaign, endCampaignTracking, resumeCampaignTracking, unlinkCampaign,
  setMomentGroup, ungroupFromMoment,
} from '@/lib/results-actions'
import SubmitButton from '@/components/SubmitButton'
import ConfirmDeleteForm from '@/components/ConfirmDeleteForm'
import { daysLive, shortDateLabel, trackedLabel, trackedSublabel, type TrackedCampaign } from '@/lib/results'

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
                      {trackedLabel(c)}
                    </Link>
                    {/* An ad-set-level row is named after the ad set — that IS
                        the moment — with the parent campaign as context. */}
                    {trackedSublabel(c) && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {trackedSublabel(c)}
                      </div>
                    )}
                    {/* Grouped: this row's own numbers are folded into a
                        combined card elsewhere. Say so here too, or someone
                        reading THIS row's figures could mistake them for the
                        moment's whole result. */}
                    {c.moment_group_id && (
                      <div style={{ fontSize: 11, marginTop: 4 }}>
                        <Link
                          href={`/results/moments/${c.moment_group_id}`}
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}
                        >
                          part of &ldquo;{c.moment_group_label}&rdquo; →
                        </Link>
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'monospace' }}>
                      {c.meta_ad_account_id} · {c.meta_campaign_id}
                      {c.meta_adset_id && ` · ${c.meta_adset_id}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      Launched {shortDateLabel(c.launched_on)} ·{' '}
                      {live
                        ? `${daysLive(c.launched_on, null, todayIso)} days live`
                        : `ended ${shortDateLabel(c.ended_on as string)} · ${daysLive(c.launched_on, c.ended_on, todayIso)} days tracked`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <span className="badge badge-brief" title={c.meta_adset_id
                      ? 'Only this ad set is pulled — not the whole campaign.'
                      : 'The whole campaign is pulled.'}>
                      {c.meta_adset_id ? 'Ad set' : 'Campaign'}
                    </span>
                    <span className={live ? 'badge badge-live' : 'badge badge-upcoming'}>
                      {live ? 'Tracking' : 'Ended'}
                    </span>
                  </div>
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
                    {c.moment_group_id && (
                      // Non-destructive — this row's own history is untouched,
                      // it just stops being folded into the combined card.
                      <form action={ungroupFromMoment.bind(null, c.id)}>
                        <SubmitButton className="btn-secondary btn-sm" pendingText="Ungrouping…">
                          Ungroup
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Grouping: for the moment that's really two ad sets — prospecting +
          retention is the pattern that surfaced this, on Mad Viking and WOW
          Sports. Plain checkboxes with a shared `name` need no client JS;
          the server action reads them all via formData.getAll. */}
      {canEdit && campaigns.length >= 2 && (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 'var(--space-5)',
          background: 'var(--surface-2)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
            <strong>Is one of these moments actually split across ad sets?</strong> Check the ones
            that belong together and give the moment a name — Results will show them as one
            combined card instead of separate ones.
          </div>
          <form action={setMomentGroup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {campaigns.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" name="tracked_campaign_id" value={c.id} defaultChecked={c.moment_group_id !== null} />
                  {trackedLabel(c)}
                  {c.moment_group_id && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      (currently in &ldquo;{c.moment_group_label}&rdquo;)
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div style={{ maxWidth: 320 }}>
              <label style={LABEL_STYLE} htmlFor="moment_group_label">Moment name</label>
              <input
                id="moment_group_label"
                name="moment_group_label"
                placeholder="Father's Day 2026"
                style={INPUT_STYLE}
              />
            </div>
            <div>
              <SubmitButton className="btn-secondary btn-sm" pendingText="Grouping…">
                Group selected
              </SubmitButton>
            </div>
          </form>
        </div>
      )}

      {canEdit ? (
        <form action={linkCampaign} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="brand_id" value={brandId} />

          <div>
            <label style={LABEL_STYLE} htmlFor="meta_ad_account_id">Ad account ID</label>
            <input
              id="meta_ad_account_id"
              name="meta_ad_account_id"
              placeholder="act_10035647"
              required
              style={{ ...INPUT_STYLE, maxWidth: 260 }}
            />
          </div>

          {/* ONE id identifies the thing being tracked — the ad set's, or the
              campaign's. Meta object IDs are globally unique, so nothing else
              is needed. The form is split this way because choosing the wrong
              scope is the difference between one moment's numbers and every
              moment in the campaign added together. */}
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
            background: 'var(--surface-2)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-3)' }}>
              <strong>Is this moment one ad set, or a whole campaign?</strong> Fill in{' '}
              <em>one</em> of the two below.
            </div>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={LABEL_STYLE} htmlFor="meta_adset_id">
                Ad set ID — one moment inside a bigger campaign
              </label>
              <input
                id="meta_adset_id"
                name="meta_adset_id"
                placeholder="52530393856787"
                style={{ ...INPUT_STYLE, maxWidth: 260 }}
              />
              <input
                id="adset_name"
                name="adset_name"
                placeholder="Ad set name (optional — filled in from Meta)"
                style={{ ...INPUT_STYLE, marginTop: 6 }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                The ad set ID is all that&apos;s needed. The campaign it belongs to and both names
                are filled in automatically on the first pull.
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
              <label style={LABEL_STYLE} htmlFor="meta_campaign_id">
                Campaign ID — the whole campaign is this one moment
              </label>
              <input
                id="meta_campaign_id"
                name="meta_campaign_id"
                placeholder="23851234567890123"
                style={{ ...INPUT_STYLE, maxWidth: 260 }}
              />
              <input
                id="campaign_name"
                name="campaign_name"
                placeholder="Campaign name (required for campaign tracking)"
                style={{ ...INPUT_STYLE, marginTop: 6 }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Only use this when the campaign holds nothing but this moment. If it holds several,
                track the ad set instead — otherwise the numbers here are all of them added together.
              </div>
            </div>

            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>
              Don&apos;t link both a campaign and an ad set inside it — that counts the ad set&apos;s
              spend twice on the Results tiles.
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
