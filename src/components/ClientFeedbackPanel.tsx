import type { ProjectComment, CreativeAsset } from '@/lib/types'
import FeedbackComment from '@/components/FeedbackComment'

// Read-only consolidation of everything the client left on the review link:
// landing-page feedback (by section) and per-creative feedback (with pins),
// plus each track's approval status. The notification bell deep-links here via
// the `#client-feedback` anchor. Each item carries a resolve/check toggle so the
// team can tick feedback off as it's handled.

const STATUS_META: Record<CreativeAsset['status'], { label: string; color: string } | null> = {
  pending: null,
  approved: { label: '✓ Approved', color: 'var(--success)' },
  needs_revision: { label: '↩ Revision requested', color: 'var(--danger)' },
  rejected: { label: '✕ Rejected', color: '#fca5a5' },
}

export default function ClientFeedbackPanel({
  lpFeedback,
  creativeFeedback,
  assets,
  lpApproved,
  creativesApproved,
  projectId,
  brandId,
  canResolve,
}: {
  lpFeedback: ProjectComment[]
  creativeFeedback: ProjectComment[]
  assets: CreativeAsset[]
  lpApproved: boolean
  creativesApproved: boolean
  projectId: string
  brandId: string
  canResolve: boolean
}) {
  const total = lpFeedback.length + creativeFeedback.length
  const doneCount = [...lpFeedback, ...creativeFeedback].filter(c => c.resolved_at != null).length
  const openCount = total - doneCount
  const hasAnything = total > 0 || lpApproved || creativesApproved

  // Group creative feedback by asset, preserving asset order; number pins per asset.
  const byAsset = new Map<string, ProjectComment[]>()
  for (const c of creativeFeedback) {
    const key = c.asset_id ?? 'unassigned'
    const list = byAsset.get(key) ?? []
    list.push(c)
    byAsset.set(key, list)
  }
  const assetName = (id: string) => assets.find(a => a.id === id)?.name ?? 'Creative'
  const assetStatus = (id: string) => assets.find(a => a.id === id)?.status ?? 'pending'

  return (
    <div id="client-feedback" className="card" style={{ scrollMarginTop: 80 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <h3 style={{ fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--text-primary)', margin: 0 }}>
          Client Feedback
        </h3>
        {total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {openCount > 0 ? `${openCount} open` : 'all done ✓'}
            {doneCount > 0 && openCount > 0 ? ` · ${doneCount} done` : ''}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {lpApproved && <span className="badge badge-done">✓ LP Approved</span>}
          {creativesApproved && <span className="badge badge-done">✓ Creatives Approved</span>}
        </div>
      </div>

      {!hasAnything ? (
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', margin: 0 }}>
          No client feedback yet. When the client comments or requests a revision on the review link,
          it appears here and the project moves to <strong>Revisions</strong>.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Landing page */}
          {lpFeedback.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Landing Page ({lpFeedback.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lpFeedback.map(c => (
                  <FeedbackComment key={c.id} comment={c} projectId={projectId} brandId={brandId} canResolve={canResolve} />
                ))}
              </div>
            </div>
          )}

          {/* Creatives, grouped per asset */}
          {byAsset.size > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Creatives ({creativeFeedback.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[...byAsset.entries()].map(([assetId, comments]) => {
                  const meta = assetId !== 'unassigned' ? STATUS_META[assetStatus(assetId)] : null
                  let pinN = 0
                  return (
                    <div key={assetId} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                          {assetId === 'unassigned' ? 'General creative notes' : assetName(assetId)}
                        </span>
                        {meta && <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
                        {comments.map(c => (
                          <FeedbackComment
                            key={c.id}
                            comment={c}
                            projectId={projectId}
                            brandId={brandId}
                            canResolve={canResolve}
                            pin={c.pin_x != null ? ++pinN : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
