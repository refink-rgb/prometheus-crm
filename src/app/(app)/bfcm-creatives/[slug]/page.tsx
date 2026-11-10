import { listBfcmFiles, prepareBfcmFileUpload, finalizeBfcmFileUpload, removeBfcmFile, getBfcmFileDownload, cleanupBfcmExpiredUploads } from '@/lib/bfcm/files'
import { planMotionReferences } from '@/lib/bfcm/content'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import BfcmAccess from '@/components/bfcm/BfcmAccess'
import BfcmPlanSize from '@/components/bfcm/BfcmPlanSize'
import BfcmPlanner from '@/components/bfcm/BfcmPlanner'
import { loadPlan, requireBfcmEditor } from '@/lib/bfcm/server'
import { saveStaffBfcmPlan } from '@/lib/bfcm/actions'
import BfcmProduction from '@/components/bfcm/BfcmProduction'
import { loadBrandDocuments, loadCalibration, loadContracts, loadPeople, loadProduction, requireStaffProfile } from '@/lib/bfcm/production-server'
import { easternToday } from '@/lib/eastern'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export default async function BfcmPlanPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireBfcmEditor()
  const { slug } = await params
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) notFound()
  let loaded
  try { loaded = await loadPlan(slug) } catch {
    return <main style={{ padding: 40 }}><h1>BFCM Creatives</h1><p role="alert">Unable to load this plan. BFCM storage must be available before editing.</p><Link href="/bfcm-creatives">Back to brands</Link></main>
  }
  const fileAccess = { slug }
  const files = await listBfcmFiles(fileAccess)
  const brandId = loaded.row.brand_id
  const [production, people, me, calibration, contracts, documents] = await Promise.all([loadProduction(slug), loadPeople(), requireStaffProfile(), loadCalibration(slug), loadContracts(brandId), loadBrandDocuments(brandId)])
  const { allocation, prePercent, noPreBf, status } = loaded.draft
  const fileActions = { prepare: prepareBfcmFileUpload.bind(null, fileAccess), finalize: finalizeBfcmFileUpload.bind(null, fileAccess), remove: removeBfcmFile.bind(null, fileAccess), download: getBfcmFileDownload.bind(null, fileAccess), cleanup: cleanupBfcmExpiredUploads.bind(null, fileAccess) }
  return <><BfcmAccess slug={slug} /><BfcmPlanSize slug={slug} brand={loaded.brand} locked={status === 'locked'} /><BfcmProduction slug={slug} brandName={loaded.brand.name} tasks={production.ok ? production.tasks : null} comments={production.ok ? production.comments : []} people={people} meId={me.id} plan={{ allocation, prePercent, noPreBf, locked: status === 'locked' }} today={easternToday()} calibration={calibration} brandId={brandId} contracts={contracts} documents={documents} /><BfcmPlanner brand={loaded.brand} initialFiles={files.ok ? files.files : []} initialFilesError={files.ok ? undefined : files.error} fileActions={fileActions} initialDraft={loaded.draft} initialVersion={loaded.row.version} saveAction={saveStaffBfcmPlan.bind(null, slug)} motionReferences={planMotionReferences(loaded.config)} sourceNotice={loaded.config.sourceNotice} /></>
}
