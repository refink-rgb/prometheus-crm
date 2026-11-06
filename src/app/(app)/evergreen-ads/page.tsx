import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { MIGRATION_FILE, MISSING_TABLE, type EvergreenCard, type EvergreenStage, type EvergreenVideoStatus } from '@/lib/evergreen'
import EvergreenBoard from '@/components/evergreen/EvergreenBoard'
import MigrationNotice from '@/components/evergreen/MigrationNotice'

type AdRow = Pick<EvergreenCard, 'id' | 'brand_id' | 'name' | 'brief_url' | 'client_approved' | 'created_at'> & {
  stage: EvergreenStage
  brands: EvergreenCard['brands']
}

export default async function EvergreenAdsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = await canEdit(user.email)

  const COLS = 'id, brand_id, name, stage, brief_url, client_approved, created_at'
  const fetchAds = (brandCols: string) =>
    supabase.from('evergreen_ads')
      .select(`${COLS}, brands(${brandCols})`)
      .eq('is_archived', false)
      .order('created_at', { ascending: true })

  const [adsFirst, { data: brandRows }] = await Promise.all([
    fetchAds('id, name, is_priority'),
    supabase.from('brands').select('id, name, is_active').order('name'),
  ])
  let { data: adsRaw, error: adsErr } = adsFirst
  // brands.is_priority arrived with a hand-run migration; fall back without it.
  if (adsErr?.code === '42703') ({ data: adsRaw, error: adsErr } = await fetchAds('id, name'))

  const tableMissing = MISSING_TABLE.has(adsErr?.code ?? '')
  const ads = (adsRaw ?? []) as unknown as AdRow[]

  // Counts for the cards: how many videos, how many the client sent back.
  const counts = new Map<string, { videos: number; changes: number; approved: number }>()
  if (ads.length) {
    const { data: videoRows } = await supabase.from('evergreen_ad_videos')
      .select('ad_id, status, client_visible')
      .in('ad_id', ads.map(a => a.id))
    for (const v of (videoRows ?? []) as Array<{ ad_id: string; status: EvergreenVideoStatus; client_visible: boolean }>) {
      const c = counts.get(v.ad_id) ?? { videos: 0, changes: 0, approved: 0 }
      c.videos++
      if (v.client_visible && (v.status === 'needs_revision' || v.status === 'rejected')) c.changes++
      if (v.client_visible && v.status === 'approved') c.approved++
      counts.set(v.ad_id, c)
    }
  }

  const cards: EvergreenCard[] = ads.map(a => ({
    ...a,
    videoCount: counts.get(a.id)?.videos ?? 0,
    changesCount: counts.get(a.id)?.changes ?? 0,
    approvedCount: counts.get(a.id)?.approved ?? 0,
  }))

  const brands = ((brandRows ?? []) as Array<{ id: string; name: string; is_active: boolean | null }>)
    .filter(b => b.is_active !== false)
    .map(b => ({ id: b.id, name: b.name }))

  return (
    <div className="page-contrast" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      padding: '20px 24px 16px',
      overflow: 'hidden',
    }}>
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Evergreen Ads
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {cards.length} active ad{cards.length !== 1 ? 's' : ''}
          {isEditor && ' · drag cards to move an ad between stages'}
        </p>
      </div>

      {tableMissing && <MigrationNotice file={MIGRATION_FILE} />}

      <EvergreenBoard cards={cards} brands={brands} canEdit={isEditor && !tableMissing} />
    </div>
  )
}
