import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { CaseStudy } from '@/data/case-studies/types'
import { getCaseStudy } from '@/data/case-studies'
import { createServiceClient } from '@/lib/supabase/service'
import ShowcaseStyles, { PE } from '@/components/showcase/ShowcaseStyles'
import Hero from '@/components/showcase/Hero'
import StatStrip from '@/components/showcase/StatStrip'
import CampaignSnapshot from '@/components/showcase/CampaignSnapshot'
import ProofShot from '@/components/showcase/ProofShot'
import Narrative from '@/components/showcase/Narrative'
import LpShowcase from '@/components/showcase/LpShowcase'
import CreativeGallery from '@/components/showcase/CreativeGallery'
import Comparison from '@/components/showcase/Comparison'
import ClosingCta from '@/components/showcase/ClosingCta'

// Tokens are minted per report at generation time, so this route is fully
// dynamic (no generateStaticParams / prerender).
export const dynamic = 'force-dynamic'

// Resolve a slug to a report. Generated reports live in the DB keyed by an
// unguessable token (read via the service role — the token is the capability).
// Falls back to the static seeded example so it still renders without the DB /
// service key (e.g. local dev). Returns null → 404.
async function loadReport(slug: string): Promise<CaseStudy | null> {
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('marketing_reports')
      .select('data')
      .eq('report_token', slug)
      .single()
    if (data?.data) return data.data as CaseStudy
  } catch {
    // Service key absent (local) or no matching row — fall through to static.
  }
  return getCaseStudy(slug) ?? null
}

// Anonymization: metadata must never carry the brand. Titles/OG are neutral and
// the page is noindex/nofollow so it never gets crawled or indexed.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const cs = await loadReport(slug)
  if (!cs) return { title: 'Case study', robots: { index: false, follow: false } }

  const title = 'Paid Media Case Study · Meta'
  const description = cs.hero.subhead
  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    },
    openGraph: { title, description, type: 'article' },
    twitter: { card: 'summary', title, description },
  }
}

export default async function ShowcasePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const cs = await loadReport(slug)
  if (!cs) notFound()

  return (
    <div className={PE}>
      <ShowcaseStyles />

      {/* Slim top bar — OUR mark (CTC / Prophit Engine), never the client's. */}
      <div
        style={{
          borderBottom: '1px solid var(--pe-border)',
          height: 56,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          className="pe-container"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: 'var(--pe-lime)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--pe-navy)',
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              P
            </div>
            <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>
              Prophit Engine
            </span>
            <span style={{ fontSize: 12, color: 'var(--pe-muted)' }}>by CTC</span>
          </div>
        </div>
      </div>

      <main>
        <Hero hero={cs.hero} />
        <StatStrip stats={cs.statStrip} />
        {cs.proof && <ProofShot proof={cs.proof} />}
        <CampaignSnapshot campaign={cs.campaign} />
        <Narrative sections={cs.narrative} />
        <LpShowcase landing={cs.landing} />
        <CreativeGallery
          creatives={cs.creatives}
          moreCount={cs.moreAdsCount ?? Math.max(0, cs.campaign.adsInTest - cs.creatives.length)}
        />
        <Comparison comparisons={cs.comparisons} />
        <ClosingCta cta={cs.closing} />
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--pe-border)',
          padding: '28px 0',
          color: 'var(--pe-muted)',
          fontSize: 13,
        }}
      >
        <div className="pe-container">
          © {new Date().getFullYear()} Common Thread Collective · Prophit Engine
        </div>
      </footer>
    </div>
  )
}
