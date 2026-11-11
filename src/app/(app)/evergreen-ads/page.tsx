import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { easternToday } from '@/lib/eastern'
import { loadPeople } from '@/lib/bfcm/production-server'
import { MIGRATION_FILE, MISSING_TABLE, isSentBack, toAd, toCreative, type EvergreenCard } from '@/lib/evergreen'
import { loadAdAssignees } from '@/lib/evergreen-server'
import EvergreenBoard from '@/components/evergreen/EvergreenBoard'
import MigrationNotice from '@/components/evergreen/MigrationNotice'

export default async function EvergreenAdsPage() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')

  // select('*'): before the 20261110 migration due_date and media_type are
  // missing, and the board must still load.
  const fetchAds = (brandCols: string) =>
    supabase.from('evergreen_ads').select(`*, brands(${brandCols})`).eq('is_archived', false).order('created_at', { ascending: true })

  const [isEditor, adsFirst, { data: brandRows }, people, profiles] = await Promise.all([
    canEdit(user.email),
    fetchAds('id, name, is_priority'),
    supabase.from('brands').select('id, name, is_active').order('name'),
    loadPeople(),
    getCachedProfiles(),
  ])
  let { data: adRows, error: adsErr } = adsFirst
  // brands.is_priority arrived with a hand-run migration; fall back without it.
  if (adsErr?.code === '42703') ({ data: adRows, error: adsErr } = await fetchAds('id, name'))

  const tableMissing = MISSING_TABLE.has(adsErr?.code ?? '')
  const ads = (adRows ?? []) as unknown as Record<string, unknown>[]
  const adIds = ads.map(a => a.id as string)

  // Counts for the cards: statics, videos, and how many the client sent back.
  const counts = new Map<string, { statics: number; videos: number; changes: number }>()
  const [creatives, team] = await Promise.all([
    adIds.length ? supabase.from('evergreen_ad_videos').select('*').in('ad_id', adIds) : Promise.resolve({ data: [] }),
    loadAdAssignees(supabase, adIds),
  ])
  for (const c of (creatives.data ?? []).map(toCreative)) {
    const n = counts.get(c.ad_id) ?? { statics: 0, videos: 0, changes: 0 }
    if (c.media_type === 'image') n.statics++; else n.videos++
    if (c.client_visible && isSentBack(c.status)) n.changes++
    counts.set(c.ad_id, n)
  }

  const cards: EvergreenCard[] = ads.map(row => {
    const a = toAd(row)
    const n = counts.get(a.id)
    return {
      id: a.id, brand_id: a.brand_id, name: a.name, stage: a.stage, brief_url: a.brief_url, due_date: a.due_date,
      client_approved: a.client_approved, created_at: a.created_at,
      brands: row.brands as EvergreenCard['brands'],
      assignees: team.byAd.get(a.id) ?? [],
      staticCount: n?.statics ?? 0, videoCount: n?.videos ?? 0, changesCount: n?.changes ?? 0,
    }
  })

  const brands = ((brandRows ?? []) as Array<{ id: string; name: string; is_active: boolean | null }>)
    .filter(b => b.is_active !== false)
    .map(b => ({ id: b.id, name: b.name }))
  const email = (user.email ?? '').toLowerCase()
  const meId = profiles.find(p => p.email.toLowerCase() === email)?.id ?? null

  return (
    <div className="page-contrast" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', padding: '20px 24px 16px', overflow: 'hidden' }}>
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

      <EvergreenBoard cards={cards} brands={brands} people={people} meId={meId} teamReady={team.ready} today={easternToday()} canEdit={isEditor && !tableMissing} />
    </div>
  )
}
