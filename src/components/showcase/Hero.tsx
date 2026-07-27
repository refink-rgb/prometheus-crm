import type { Hero as HeroData } from '@/data/case-studies/types'

export default function Hero({ hero }: { hero: HeroData }) {
  return (
    <header
      style={{
        // Navy → subtle lime glow, per brand hero direction.
        background:
          'radial-gradient(120% 90% at 80% -10%, rgba(211,240,95,0.18) 0%, rgba(0,228,230,0.06) 35%, transparent 65%), var(--pe-navy)',
        borderBottom: '1px solid var(--pe-border)',
        paddingTop: 96,
        paddingBottom: 72,
      }}
    >
      <div className="pe-container pe-fade">
        <p className="pe-eyebrow" style={{ marginBottom: 22 }}>
          {hero.eyebrow}
        </p>

        <h1
          style={{
            fontSize: 'clamp(34px, 5.4vw, 64px)',
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            margin: '0 0 20px',
            maxWidth: 900,
            color: 'var(--pe-white)',
          }}
        >
          {hero.headline}
        </h1>

        <p
          style={{
            fontSize: 'clamp(16px, 2.2vw, 20px)',
            lineHeight: 1.45,
            color: 'var(--pe-off)',
            maxWidth: 680,
            margin: '0 0 56px',
            fontWeight: 400,
          }}
        >
          {hero.subhead}
        </p>

        {/* The oversized hero stat — the largest element on the page. */}
        <div style={{ margin: '0 0 44px' }}>
          <div className="pe-stat-mega">{hero.stat.value}</div>
          <div
            style={{
              fontSize: 'clamp(15px, 2.4vw, 22px)',
              color: 'var(--pe-lime)',
              fontWeight: 500,
              marginTop: 8,
              maxWidth: 560,
            }}
          >
            {hero.stat.caption}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '28px 56px',
            borderTop: '1px solid var(--pe-border)',
            paddingTop: 28,
          }}
        >
          {hero.meta.map((m) => (
            <div key={m.label} style={{ minWidth: 0 }}>
              <p className="pe-label" style={{ marginBottom: 6 }}>
                {m.label}
              </p>
              <p style={{ margin: 0, fontSize: 15, color: 'var(--pe-white)', fontWeight: 500 }}>
                {m.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}
