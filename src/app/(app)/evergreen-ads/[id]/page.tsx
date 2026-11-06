import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import {
  AD_COLUMNS, COMMENT_COLUMNS, MIGRATION_FILE, MISSING_TABLE, VIDEO_COLUMNS,
  type EvergreenAd, type EvergreenComment, type EvergreenVideo,
} from '@/lib/evergreen'
import EvergreenAdDetail from '@/components/evergreen/EvergreenAdDetail'
import MigrationNotice from '@/components/evergreen/MigrationNotice'

// Copying a large video in from Drive runs inside one Server Action on this
// page. Page-level maxDuration covers them (same as the BFCM and project pages).
export const maxDuration = 300

export default async function EvergreenAdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) redirect('/login')
  const isEditor = await canEdit(user.email)

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const { data: adRaw, error: adErr } = await supabase
    .from('evergreen_ads').select(`${AD_COLUMNS}, brands(id, name)`).eq('id', id).maybeSingle()

  if (MISSING_TABLE.has(adErr?.code ?? '')) {
    return (
      <div style={{ padding: 'var(--space-6) 32px' }}>
        <MigrationNotice file={MIGRATION_FILE} />
        <Link href="/evergreen-ads" className="btn-secondary btn-sm">← Evergreen Ads</Link>
      </div>
    )
  }
  if (!adRaw) notFound()

  const ad = adRaw as unknown as EvergreenAd & { brands: { id: string; name: string } | null }

  const [{ data: videosRaw }, { data: commentsRaw }, drive] = await Promise.all([
    supabase.from('evergreen_ad_videos').select(VIDEO_COLUMNS).eq('ad_id', id).order('sort_order').order('created_at'),
    supabase.from('evergreen_ad_comments').select(COMMENT_COLUMNS).eq('ad_id', id).order('created_at'),
    // Read on its own: before the Drive migration runs this column is missing,
    // and that must only switch off Drive sync, not break the page.
    supabase.from('evergreen_ads').select('drive_folder_url').eq('id', id).maybeSingle(),
  ])

  return (
    <div className="page-contrast" style={{ padding: '20px 32px 48px', maxWidth: 1320 }}>
      <EvergreenAdDetail
        ad={ad}
        brandName={ad.brands?.name ?? 'Unknown brand'}
        videos={(videosRaw ?? []) as unknown as EvergreenVideo[]}
        comments={(commentsRaw ?? []) as unknown as EvergreenComment[]}
        canEdit={isEditor}
        driveFolderUrl={(drive.data?.drive_folder_url as string | null | undefined) ?? null}
        driveReady={!drive.error}
      />
    </div>
  )
}
