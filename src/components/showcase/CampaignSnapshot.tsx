import type { SnapshotTile } from '@/data/case-studies/types'

// The "at a glance" band. Tiles are authored per report, so each case study can
// lead with the metrics its story actually turns on.
export default function CampaignSnapshot({ tiles }: { tiles: SnapshotTile[] }) {
  const shown = tiles.filter((t) => t.label.trim() && t.value.trim())
  if (shown.length === 0) return null

  return (
    <section aria-label="Campaign at a glance" style={{ padding: '8px 0 64px' }}>
      <div className="pe-container">
        <p className="pe-eyebrow" style={{ marginBottom: 20 }}>
          Campaign at a glance
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 1,
            background: 'var(--pe-border)',
            border: '1px solid var(--pe-border)',
            borderRadius: 20,
            overflow: 'hidden',
          }}
        >
          {shown.map((t) => (
            <div key={t.label} style={{ background: 'var(--pe-card)', padding: '24px 22px' }}>
              <div
                style={{
                  fontSize: 'clamp(26px, 3.4vw, 38px)',
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  color: 'var(--pe-white)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {t.value}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--pe-muted)',
                  marginTop: 8,
                }}
              >
                {t.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
