import type { Profile, Stage } from '@/lib/types'
import { profileName } from '@/lib/types'

// A track counts toward someone's capacity while the work is actually on their
// plate: brief, in progress, internal review — and revisions, since the client
// has sent it back to them. Client review, ready, and live are off their desk —
// a 'ready' track is built and signed off, it's just waiting to be launched.
export const WORKING_STAGES: readonly Stage[] = ['brief', 'in_progress', 'internal_review', 'revisions']

export type CapacityProject = {
  lp_editor_id: string | null
  creative_editor_id: string | null
  lp_stage: Stage
  creatives_stage: Stage
  is_complete: boolean
}

export type CapacityRow = {
  id: string
  name: string
  lp: number
  creative: number
  total: number
}

export type CapacitySummary = {
  rows: CapacityRow[]
  unassignedLp: number
  unassignedCreative: number
}

export function computeCapacity(profiles: Profile[], projects: CapacityProject[]): CapacitySummary {
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
      return { id: profile.id, name: profileName(profile), lp, creative, total: lp + creative }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  return {
    rows,
    unassignedLp: active.filter(pr => !pr.lp_editor_id && WORKING_STAGES.includes(pr.lp_stage)).length,
    unassignedCreative: active.filter(pr => !pr.creative_editor_id && WORKING_STAGES.includes(pr.creatives_stage)).length,
  }
}
