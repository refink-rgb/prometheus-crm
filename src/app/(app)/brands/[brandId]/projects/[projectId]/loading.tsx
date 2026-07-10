// Skeleton for the project detail page — it runs 5+ parallel queries
// (project, brand, images, creative_assets, comments, notes, journeys) so
// this fires on every hard navigation.

export default function ProjectLoading() {
  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ height: 14, width: 200, background: 'var(--surface-raised)', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 28, width: 320, background: 'var(--surface-raised)', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 12, width: 160, background: 'var(--surface-raised)', borderRadius: 4 }} />
      </div>

      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        height: 80,
        marginBottom: 24,
      }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 20 }}>
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          height: 520,
        }} />
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          height: 520,
        }} />
      </div>
    </div>
  )
}
