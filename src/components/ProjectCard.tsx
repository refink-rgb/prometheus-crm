import Link from 'next/link'
import type { Project } from '@/lib/types'
import { calcDaysUntil, cardBorderColor, isProjectLive, isProjectOverdue, parseDueDate } from '@/lib/stageColors'
import DualStageBar from './DualStageBar'

interface ProjectCardProps {
  project: Project
  brandName?: string
  journeyName?: string | null
  href: string
  compact?: boolean
  flaggedAssetCount?: number
}

export default function ProjectCard({
  project,
  brandName,
  journeyName,
  href,
  compact = false,
  flaggedAssetCount = 0,
}: ProjectCardProps) {
  const daysUntil = calcDaysUntil(project.due_date)
  const isOverdue = isProjectOverdue(project.due_date, project.is_complete, project.lp_stage, project.creatives_stage)
  const isShipped = isProjectLive(project.lp_stage, project.creatives_stage)
  const borderColor = cardBorderColor(isOverdue, daysUntil, project.lp_stage, project.creatives_stage)

  const showClientRow = !!project.share_token && !compact

  const dueDateStr = parseDueDate(project.due_date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? null

  const tag = brandName ?? journeyName ?? null

  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div
        className="project-card"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderLeft: `4px solid ${borderColor}`,
          borderRadius: 10,
          padding: compact ? '12px 14px 12px 14px' : '14px 18px 14px 18px',
          transition: 'background 0.12s, border-color 0.12s, transform 0.1s',
          cursor: 'pointer',
        }}
      >
        {/* Row 1: tag + urgency */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {tag ?? ''}
          </span>
          <UrgencyBadge
            daysUntil={daysUntil}
            isOverdue={isOverdue}
            isComplete={project.is_complete}
            isShipped={isShipped}
            dueDateStr={dueDateStr}
          />
        </div>

        {/* Row 2: project name */}
        <div style={{
          fontSize: 14.5,
          fontWeight: 500,
          color: 'var(--text-primary)',
          marginBottom: 12,
          lineHeight: 1.3,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {project.name}
        </div>

        {/* Row 3: DualStageBar */}
        <DualStageBar
          lp_stage={project.lp_stage}
          creatives_stage={project.creatives_stage}
          lp_approved={project.lp_approved}
          creatives_approved={project.creatives_approved}
        />

        {/* Client status footer */}
        {showClientRow && (
          <>
            <div style={{ height: 1, background: 'var(--border)', margin: '12px -18px 10px' }} />
            <ClientStatusRow
              project={project}
              flaggedAssetCount={flaggedAssetCount}
            />
          </>
        )}
      </div>
    </Link>
  )
}

function UrgencyBadge({
  daysUntil,
  isOverdue,
  isComplete,
  isShipped,
  dueDateStr,
}: {
  daysUntil: number | null
  isOverdue: boolean
  isComplete: boolean
  isShipped: boolean
  dueDateStr: string | null
}) {
  const base: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 9px',
    borderRadius: 20,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }

  if (isComplete) {
    return (
      <span style={{
        ...base,
        background: 'var(--stage-done-bg)',
        color: 'var(--stage-done-text)',
        border: '1px solid color-mix(in srgb, #10B981 30%, transparent)',
      }}>
        ✓ Complete
      </span>
    )
  }

  if (isShipped) {
    return (
      <span style={{
        ...base,
        background: 'var(--stage-live-bg)',
        color: 'var(--stage-live-text)',
        border: '1px solid color-mix(in srgb, #65A30D 30%, transparent)',
      }}>
        ✓ Live
      </span>
    )
  }

  if (isOverdue && daysUntil !== null) {
    return (
      <span style={{
        ...base,
        background: 'var(--urgent-overdue-bg)',
        color: 'var(--urgent-overdue)',
        border: '1px solid color-mix(in srgb, #EF4444 35%, transparent)',
      }}>
        ⚠ {Math.abs(daysUntil)} day{Math.abs(daysUntil) === 1 ? '' : 's'} overdue
      </span>
    )
  }

  if (daysUntil === 0) {
    return (
      <span style={{
        ...base,
        background: 'var(--urgent-overdue-bg)',
        color: 'var(--urgent-overdue)',
        border: '1px solid color-mix(in srgb, #EF4444 35%, transparent)',
      }}>
        ⚠ Due today
      </span>
    )
  }

  if (daysUntil !== null && daysUntil <= 4) {
    return (
      <span style={{
        ...base,
        background: 'var(--urgent-soon-bg)',
        color: 'var(--urgent-soon)',
        border: '1px solid color-mix(in srgb, var(--urgent-soon) 35%, transparent)',
      }}>
        ⏰ {daysUntil} day{daysUntil === 1 ? '' : 's'} left
      </span>
    )
  }

  if (daysUntil !== null) {
    return (
      <span style={{ ...base, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
        Due in {daysUntil} day{daysUntil === 1 ? '' : 's'}
        {dueDateStr ? ` · ${dueDateStr}` : ''}
      </span>
    )
  }

  return <span style={{ ...base, color: 'var(--text-muted)' }}>No due date</span>
}

function ClientStatusRow({
  project,
  flaggedAssetCount,
}: {
  project: Project
  flaggedAssetCount: number
}) {
  const items: React.ReactNode[] = []

  // LP
  if (project.lp_approved) {
    items.push(<Item key="lp" tone="ok">✓ LP approved</Item>)
  } else if (project.lp_stage === 'client_review') {
    items.push(<Item key="lp" tone="muted">○ LP: awaiting client</Item>)
  } else {
    items.push(<Item key="lp" tone="muted">○ LP: not in review</Item>)
  }

  // Creatives
  if (project.creatives_approved) {
    items.push(<Item key="cr" tone="ok">✓ Creatives approved</Item>)
  } else if (flaggedAssetCount > 0) {
    items.push(<Item key="cr" tone="bad">✗ {flaggedAssetCount} flagged</Item>)
  } else if (project.creatives_stage === 'client_review') {
    items.push(<Item key="cr" tone="muted">○ Creatives: awaiting client</Item>)
  } else {
    items.push(<Item key="cr" tone="muted">○ Creatives: pending</Item>)
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
      {items.map((el, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {el}
          {i < items.length - 1 && <span style={{ color: 'var(--text-muted)' }}>·</span>}
        </span>
      ))}
    </div>
  )
}

function Item({ tone, children }: { tone: 'ok' | 'bad' | 'muted'; children: React.ReactNode }) {
  const color =
    tone === 'ok'  ? 'var(--client-approved)' :
    tone === 'bad' ? 'var(--client-flagged)'  :
                     'var(--text-muted)'
  return <span style={{ color, fontWeight: tone === 'muted' ? 400 : 600 }}>{children}</span>
}
