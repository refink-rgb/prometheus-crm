import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { easternToday } from '@/lib/eastern'
import { loadPeople } from '@/lib/bfcm/production-server'
import { MIGRATION_FILE, MISSING_TABLE, isUuid, toAd, toComment, toCreative } from '@/lib/evergreen'
import { loadAdAssignees } from '@/lib/evergreen-server'
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
  if (!isUuid(id)) notFound()

  // select('*') everywhere: before the 20261110 migration the newer columns are
  // missing, and that must only switch those features off, not break the page.
  const [isEditor, { data: adRow, error: adErr }] = await Promise.all([
    canEdit(user.email),
    supabase.from('evergreen_ads').select('*, brands(id, name)').eq('id', id).maybeSingle(),
  ])

  if (MISSING_TABLE.has(adErr?.code ?? '')) {
    return (
      <div style={{ padding: 'var(--space-6) 32px' }}>
        <MigrationNotice file={MIGRATION_FILE} />
        <Link href="/evergreen-ads" className="btn-secondary btn-sm">← Evergreen Ads</Link>
      </div>
    )
  }
  if (!adRow) notFound()

  const [{ data: creativeRows }, { data: commentRows }, team, people] = await Promise.all([
    supabase.from('evergreen_ad_videos').select('*').eq('ad_id', id).order('sort_order').order('created_at'),
    supabase.from('evergreen_ad_comments').select('*').eq('ad_id', id).order('created_at'),
    loadAdAssignees(supabase, [id]),
    loadPeople(),
  ])

  return (
    <div className="page-contrast" style={{ padding: '20px 32px 48px', maxWidth: 1320 }}>
      <EvergreenAdDetail
        ad={toAd(adRow)}
        brandName={(adRow.brands as { name?: string } | null)?.name ?? 'Unknown brand'}
        creatives={(creativeRows ?? []).map(toCreative)}
        comments={(commentRows ?? []).map(toComment)}
        canEdit={isEditor}
        people={people}
        assignees={team.byAd.get(id) ?? []}
        teamReady={team.ready}
        driveFolderUrl={(adRow.drive_folder_url as string | null | undefined) ?? null}
        today={easternToday()}
      />
    </div>
  )
}
