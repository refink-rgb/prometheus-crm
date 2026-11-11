import Link from 'next/link'
import type { Project } from '@/lib/types'
import { isProjectOverdue, parseAndDaysUntil } from '@/lib/stageColors'
import { easternToday } from '@/lib/eastern'
import type { MyBfcmTask } from '@/lib/bfcm/production-server'
import type { MyEvergreenAd } from '@/lib/evergreen-server'
import { EVERGREEN_STAGE_LABELS } from '@/lib/evergreen'

type PipelineProject = Project & { brands: { id: string; name: string } }

// "What am I on?" — only answerable now that editors are real user IDs rather
// than name strings. Shows both tracks, since a person can hold either or both.
export default function MyAssignmentsPanel({
  projects,
  profileId,
  bfcmTasks = [],
  evergreenAds = [],
}: {
  projects: PipelineProject[]
  profileId: string
  /** Open BFCM production tasks this person is on (see loadMyBfcmTasks). */
  bfcmTasks?: MyBfcmTask[]
  /** Evergreen ads this person is building that are not live yet (see loadMyEvergreenAds). */
  evergreenAds?: MyEvergreenAd[]
}) {
  const today = easternToday()
  const mine = projects
    .filter(p => p.lp_editor_id === profileId || p.creative_editor_id === profileId)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  return (
    <div className="card" style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
          My Work
        </h3>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {mine.length} project{mine.length === 1 ? '' : 's'}{bfcmTasks.length > 0 ? ` · ${bfcmTasks.length} BFCM` : ''}{evergreenAds.length > 0 ? ` · ${evergreenAds.length} evergreen` : ''}
        </span>
      </div>

      {mine.length === 0 && bfcmTasks.length === 0 && evergreenAds.length === 0 ? (
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', padding: 'var(--space-4) 0' }}>
          Nothing assigned to you right now.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {mine.map(p => {
            const { due, daysUntil } = parseAndDaysUntil(p.due_date)
            const overdue = isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)
            const isLp = p.lp_editor_id === profileId
            const isCreative = p.creative_editor_id === profileId

            return (
              <Link
                key={p.id}
                href={`/brands/${p.brand_id}/projects/${p.id}`}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div className="pipeline-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-1)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {p.brands.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {/* Which hat you're wearing on this one. */}
                    {isLp && (
                      <span title="You're the LP editor" style={{
                        fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                        color: 'var(--editor-lp)',
                        background: 'color-mix(in srgb, var(--editor-lp) 12%, transparent)',
                      }}>LP</span>
                    )}
                    {isCreative && (
                      <span title="You're the creative editor" style={{
                        fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                        color: 'var(--editor-creative)',
                        background: 'color-mix(in srgb, var(--editor-creative) 12%, transparent)',
                      }}>CR</span>
                    )}
                    <span style={{
                      fontSize: 'var(--text-xs)', whiteSpace: 'nowrap',
                      color: overdue ? 'var(--urgent-overdue)' : 'var(--text-muted)',
                      fontWeight: overdue ? 600 : 400,
                    }}>
                      {overdue && daysUntil !== null
                        ? `${Math.abs(daysUntil)}d late`
                        : due?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? '—'}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
          {bfcmTasks.map(t => {
            const late = !!t.due_date && t.due_date < today
            return (
              <Link key={t.id} href={`/bfcm-creatives/${t.plan_slug}#task-${t.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                <div className="pipeline-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-1)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {t.brand} · BFCM
                    </div>
                    <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.parent_title ? `${t.parent_title} › ${t.title}` : t.title}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 'var(--text-xs)', whiteSpace: 'nowrap', flexShrink: 0,
                    color: late ? 'var(--urgent-overdue)' : 'var(--text-muted)',
                    fontWeight: late ? 600 : 400,
                  }}>
                    {t.due_date
                      ? new Date(`${t.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'}
                  </span>
                </div>
              </Link>
            )
          })}
          {evergreenAds.map(a => {
            const late = !!a.due_date && a.due_date < today
            return (
              <Link key={a.id} href={`/evergreen-ads/${a.id}`} style={{ textDecoration: 'none', display: 'block' }}>
                <div className="pipeline-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-1)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {a.brand ? `${a.brand} · ` : ''}Evergreen · {EVERGREEN_STAGE_LABELS[a.stage] ?? a.stage}
                    </div>
                    <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 'var(--text-xs)', whiteSpace: 'nowrap', flexShrink: 0,
                    color: late ? 'var(--urgent-overdue)' : 'var(--text-muted)',
                    fontWeight: late ? 600 : 400,
                  }}>
                    {a.due_date
                      ? new Date(`${a.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
