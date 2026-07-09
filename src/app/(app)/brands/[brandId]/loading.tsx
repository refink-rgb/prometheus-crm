// Skeleton for the brand page while its projects/profit-engineers/journeys
// fetch. Dimensions echo the real layout so content swaps in without shift.

export default function BrandLoading() {
  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ height: 26, width: 220, background: 'var(--surface-raised)', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 14, width: 140, background: 'var(--surface-raised)', borderRadius: 4 }} />
      </div>

      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        height: 260,
        marginBottom: 32,
      }} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            height: 160,
          }} />
        ))}
      </div>
    </div>
  )
}
