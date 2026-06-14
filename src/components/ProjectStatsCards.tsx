interface Props {
  totalActive: number
  inReview: number
  overdue: number
  completedThisMonth: number
}

export default function ProjectStatsCards({ totalActive, inReview, overdue, completedThisMonth }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
      <NumCard label="Active Projects" value={totalActive} />
      <NumCard label="In Review" value={inReview} color="var(--warning)" />
      <NumCard label="Overdue" value={overdue} color={overdue > 0 ? 'var(--danger)' : 'var(--text-primary)'} />
      <NumCard label="Completed This Month" value={completedThisMonth} color="var(--success)" />
    </div>
  )
}

function NumCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '20px 22px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color ?? 'var(--text-primary)', letterSpacing: '-0.03em' }}>
        {value}
      </div>
    </div>
  )
}
