import { listBfcmFiles, prepareBfcmFileUpload, finalizeBfcmFileUpload, removeBfcmFile, getBfcmFileDownload, cleanupBfcmExpiredUploads } from '@/lib/bfcm/files'
import { planMotionReferences } from '@/lib/bfcm/content'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import BfcmPlanner from '@/components/bfcm/BfcmPlanner'
import { loadPlan, resolveClientPlan } from '@/lib/bfcm/server'
import { saveClientBfcmPlan } from '@/lib/bfcm/actions'
import { BFCM_SEASON_OPEN } from '@/lib/bfcm/season'
import BfcmSeasonClosed from '@/components/bfcm/BfcmSeasonClosed'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const metadata: Metadata = { title: 'BFCM Plan', robots: { index: false, follow: false }, referrer: 'no-referrer' }
export default async function ClientBfcmPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveClientPlan(token)
  if (!resolved) notFound()
  if (!BFCM_SEASON_OPEN) return <BfcmSeasonClosed />
  const loaded = await loadPlan(resolved.slug, resolved.client)
  const fileAccess = { token }
  const files = await listBfcmFiles(fileAccess)
  const fileActions = { prepare: prepareBfcmFileUpload.bind(null, fileAccess), finalize: finalizeBfcmFileUpload.bind(null, fileAccess), remove: removeBfcmFile.bind(null, fileAccess), download: getBfcmFileDownload.bind(null, fileAccess), cleanup: cleanupBfcmExpiredUploads.bind(null, fileAccess) }
  return <BfcmPlanner brand={loaded.brand} initialFiles={files.ok ? files.files : []} initialFilesError={files.ok ? undefined : files.error} fileActions={fileActions} initialDraft={loaded.draft} initialVersion={loaded.row.version} saveAction={saveClientBfcmPlan.bind(null, token)} motionReferences={planMotionReferences(loaded.config)} sourceNotice={loaded.config.sourceNotice} backHref={`/portal/bfcm/${token}`} />
}
