import type { CampaignFigures } from '@/data/case-studies/types'
import { fmtInt, fmtRoas, fmtUsd } from './format'

// Absolute campaign totals (the real supplied numbers), surfaced as a stat band
// so the page stands on real data. Values come from the data file; labels are
// fixed here, matching how StatStrip / Comparison are authored.
export default function CampaignSnapshot({ campaign }: { campaign: CampaignFigures }) {
  const tiles: { label: string; value: string }[] = [
    { label: 'Revenue', value: fmtUsd(campaign.revenue) },
    { label: 'Purchases', value: fmtInt(campaign.purchases) },
    { label: 'Cost per purchase', value: fmtUsd(campaign.costPerPurchase) },
    { label: 'Blended ROAS', value: fmtRoas(campaign.blendedRoas) },
    { label: 'Ads in test', value: fmtInt(campaign.adsInTest) },
  ]

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
          {tiles.map((t) => (
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

        <p style={{ fontSize: 13, color: 'var(--pe-muted)', margin: '16px 0 0' }}>
          Measured against the rest of the account: {fmtInt(campaign.restOfAccountAds)} ads,{' '}
          {fmtUsd(campaign.restOfAccountRevenue)} revenue.
        </p>
      </div>
    </section>
  )
}
