import type { Project } from '@/lib/types'
import { calcDaysUntil, isProjectOverdue, parseDueDate } from '@/lib/stageColors'
import ProjectCard from './ProjectCard'

type ProjectWithBrand = Project & { brand_name: string }

interface ActiveProjectsPanelProps {
  projects: ProjectWithBrand[]
}

type GroupKey =
  | 'overdue'
  | 'due_this_week'
  | 'revisions'
  | 'client_waiting_on_us'
  | 'in_client_review'
  | 'internal_review'
  | 'in_progress'
  | 'briefing'

const GROUP_META: Record<GroupKey, { label: string; dot: string; color: string }> = {
  overdue:              { label: 'Overdue',                  dot: '🔴', color: 'var(--urgent-overdue)' },
  due_this_week:        { label: 'Due this week',            dot: '🟠', color: 'var(--urgent-soon)' },
  revisions:            { label: 'Revisions requested',      dot: '🔁', color: '#F43F5E' },
  client_waiting_on_us: { label: 'Client waiting on us',     dot: '🟡', color: '#F59E0B' },
  in_client_review:     { label: 'In client review',         dot: '🟡', color: '#F59E0B' },
  internal_review:      { label: 'Internal review',          dot: '🟣', color: '#818CF8' },
  in_progress:          { label: 'In progress',              dot: '🔵', color: '#60A5FA' },
  briefing:             { label: 'Briefing',                 dot: '⚪', color: 'var(--text-muted)' },
}

const GROUP_ORDER: GroupKey[] = [
  'overdue',
  'due_this_week',
  'revisions',
  'client_waiting_on_us',
  'in_client_review',
  'internal_review',
  'in_progress',
  'briefing',
]

function classify(p: ProjectWithBrand): GroupKey | null {
  const days = calcDaysUntil(p.due_date)
  if (isProjectOverdue(p.due_date, p.is_complete, p.lp_stage, p.creatives_stage)) return 'overdue'
  if (days !== null && days >= 0 && days <= 7 && !p.is_complete) return 'due_this_week'
  // Client left feedback and a track moved to Revisions — the team owes an edit.
  if (p.lp_stage === 'revisions' || p.creatives_stage === 'revisions') return 'revisions'
  if ((p.lp_approved && p.lp_stage !== 'done') || (p.creatives_approved && p.creatives_stage !== 'done')) {
    return 'client_waiting_on_us'
  }
  if (p.lp_stage === 'client_review' || p.creatives_stage === 'client_review') return 'in_client_review'
  if (p.lp_stage === 'internal_review' || p.creatives_stage === 'internal_review') return 'internal_review'
  if (p.lp_stage === 'in_progress' || p.creatives_stage === 'in_progress') return 'in_progress'
  if (p.lp_stage === 'brief' && p.creatives_stage === 'brief') return 'briefing'
  return null
}

export default function ActiveProjectsPanel({ projects }: ActiveProjectsPanelProps) {
  const grouped = new Map<GroupKey, ProjectWithBrand[]>()
  for (const p of projects) {
    if (p.is_complete) continue
    const key = classify(p)
    if (!key) continue
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(p)
  }

  // Sort each group by due_date ASC
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      const da = parseDueDate(a.due_date)?.getTime() ?? Infinity
      const db = parseDueDate(b.due_date)?.getTime() ?? Infinity
      return da - db
    })
  }

  const groups = GROUP_ORDER
    .map(key => ({ key, items: grouped.get(key) ?? [] }))
    .filter(g => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        No active projects.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {groups.map(({ key, items }) => {
        const meta = GROUP_META[key]
        return (
          <div key={key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                {meta.dot} {meta.label}
              </span>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: meta.color,
                background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
                padding: '1px 7px',
                borderRadius: 20,
              }}>
                {items.length}
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  brandName={p.brand_name}
                  href={`/brands/${p.brand_id}/projects/${p.id}`}
                  compact
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
