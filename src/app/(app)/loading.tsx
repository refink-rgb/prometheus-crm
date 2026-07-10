// Shown while any page under the (app) group is fetching. Keeps the shell
// stable so navigation feels instant instead of blank-then-content.

export default function AppLoading() {
  return (
    <div style={{ padding: '28px 32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ height: 26, width: 180, background: 'var(--surface-raised)', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ height: 14, width: 120, background: 'var(--surface-raised)', borderRadius: 4 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 18px',
            height: 76,
          }} />
        ))}
      </div>

      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        height: 220,
        marginBottom: 20,
      }} />

      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        height: 320,
      }} />
    </div>
  )
}
