import type { Profile, Project, Stage } from '@/lib/types'
import { profileName } from '@/lib/types'
import Avatar from '@/components/Avatar'

// A track counts toward someone's capacity while the work is actually on their
// plate: brief, in progress, internal review — and revisions, since the client
// has sent it back to them. Client review, live, and done are off their desk.
const WORKING_STAGES: readonly Stage[] = ['brief', 'in_progress', 'internal_review', 'revisions']

type CapacityRow = {
  profile: Profile
  lp: number
  creative: number
  total: number
}

function badgeColor(total: number): string {
  if (total === 0) return 'var(--text-muted)'
  if (total <= 2) return 'var(--success)'
  if (total <= 4) return '#F59E0B'
  return '#EF4444'
}

export default function TeamCapacityPanel({
  profiles,
  projects,
}: {
  profiles: Profile[]
  projects: Pick<Project, 'lp_editor_id' | 'creative_editor_id' | 'lp_stage' | 'creatives_stage' | 'is_complete'>[]
}) {
  const active = projects.filter(p => !p.is_complete)

  const rows: CapacityRow[] = profiles
    .filter(p => p.is_lp_editor || p.is_creative_editor)
    .map(profile => {
      const lp = active.filter(
        pr => pr.lp_editor_id === profile.id && WORKING_STAGES.includes(pr.lp_stage)
      ).length
      const creative = active.filter(
        pr => pr.creative_editor_id === profile.id && WORKING_STAGES.includes(pr.creatives_stage)
      ).length
      return { profile, lp, creative, total: lp + creative }
    })
    .sort((a, b) => b.total - a.total || profileName(a.profile).localeCompare(profileName(b.profile)))

  // Working-stage tracks nobody owns yet — the invisible backlog.
  const unassignedLp = active.filter(pr => !pr.lp_editor_id && WORKING_STAGES.includes(pr.lp_stage)).length
  const unassignedCreative = active.filter(pr => !pr.creative_editor_id && WORKING_STAGES.includes(pr.creatives_stage)).length

  if (rows.length === 0) return null

  return (
    <div className="card">
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Team Capacity
        </h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
          Assigned tracks in Brief / In Progress / Internal Review / Revisions — drops off at Client Review
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ profile, lp, creative, total }) => (
          <div
            key={profile.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 8px', borderRadius: 8,
              background: total > 0 ? 'var(--surface-raised)' : 'transparent',
            }}
          >
            <Avatar name={profileName(profile)} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profileName(profile)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {profile.is_lp_editor && `LP ${lp}`}
                {profile.is_lp_editor && profile.is_creative_editor && ' · '}
                {profile.is_creative_editor && `Creative ${creative}`}
              </div>
            </div>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: badgeColor(total),
              background: `color-mix(in srgb, ${badgeColor(total)} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${badgeColor(total)} 30%, transparent)`,
              borderRadius: 14, padding: '2px 10px', minWidth: 34, textAlign: 'center',
            }}>
              {total}
            </span>
          </div>
        ))}
      </div>

      {(unassignedLp > 0 || unassignedCreative > 0) && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 0', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          Unassigned active tracks: {unassignedLp > 0 && `${unassignedLp} LP`}
          {unassignedLp > 0 && unassignedCreative > 0 && ' · '}
          {unassignedCreative > 0 && `${unassignedCreative} Creative`}
        </p>
      )}
    </div>
  )
}
