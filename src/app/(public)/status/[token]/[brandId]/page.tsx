import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { countBoard, loadBoard, resolveStatusToken, type BoardAsset, type BoardProject } from '@/lib/status/server'
import { BUCKET_LABELS, safeName, tallyLine, type Bucket } from '@/lib/status/board'
import { clientPosterOf, isVideoAsset } from '@/lib/creative-media'
import { driveThumb, resizeDriveThumb } from '@/lib/drive-thumb'
import { normalizeStage } from '@/lib/types'
import StagePill from '@/components/StagePill'
import DownloadApproved, { type DownloadFile } from '@/components/status/DownloadApproved'
import { StatusShell, Tile, Tiles } from '@/components/status/StatusShell'
import OpenHashTarget from '@/components/status/OpenHashTarget'

// One brand on a profit engineer's status board: every project by where it
// stands, with the client-approved files to download. Read-only, no account.
//
// Only client-approved creatives are shown or downloadable. Anything the team
// approved internally but the client has not seen stays out, so a strategist
// cannot launch a file the client never signed off.

export const metadata: Metadata = { title: 'Project status', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const THUMBS = 12
const dueLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso.slice(0, 10) + 'T12:00:00'))

export default async function StatusBrandPage({
  params,
}: {
  params: Promise<{ token: string; brandId: string }>
}) {
  const { token, brandId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(brandId)) notFound()
  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) notFound()

  const board = await loadBoard(service, engineer, brandId)
  const brand = board?.[0]
  if (!brand) notFound()

  const counts = countBoard(brand.projects)
  const inBucket = (b: Bucket) => brand.projects.filter(p => p.bucket === b)
  const ready = inBucket('ready')
  // Latest first: the launch a strategist is looking for is the recent one.
  const launched = inBucket('launched').reverse()

  const readyFiles: DownloadFile[] = ready.flatMap(p =>
    p.approved.map(a => ({ id: a.id, name: fileName(a), folder: safeName(p.name, 'project') })),
  )

  return (
    <StatusShell>
      <OpenHashTarget />
      <Link href={`/status/${token}`} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← All brands
      </Link>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
            {brand.name}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Where each project stands. Downloads hold only files the client approved.
          </p>
        </div>
        {readyFiles.length > 0 && (
          <DownloadApproved
            token={token}
            files={readyFiles}
            zipName={`${safeName(brand.name, 'brand')}-ready`}
            label={`Download everything ready (${readyFiles.length})`}
            primary
          />
        )}
      </div>

      <Tiles>
        <Tile label="Ready to launch" value={counts.ready} unit="project" tone="good" />
        <Tile label="In the works" value={counts.working + counts.upcoming} unit="project" />
        <Tile label="Running late" value={counts.late} unit="project" tone="bad" />
        <Tile label="Approved by the client" value={counts.approvedFiles} unit="file" />
      </Tiles>

      {brand.projects.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10) var(--space-6)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No projects on this brand yet.</p>
        </div>
      )}

      <Section bucket="ready" projects={ready} token={token} />
      <Section bucket="working" projects={inBucket('working')} token={token} />
      <Section bucket="upcoming" projects={inBucket('upcoming')} token={token} />

      {launched.length > 0 && (
        <details style={{ marginTop: 'var(--space-8)' }}>
          <summary style={{
            cursor: 'pointer', fontSize: 'var(--text-md)', fontWeight: 700,
            color: 'var(--text-primary)', padding: '6px 0',
          }}>
            {BUCKET_LABELS.launched} ({launched.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {launched.map(p => <ProjectCard key={p.id} project={p} token={token} compact />)}
          </div>
        </details>
      )}
    </StatusShell>
  )
}

function Section({ bucket, projects, token }: { bucket: Bucket; projects: BoardProject[]; token: string }) {
  if (projects.length === 0) return null
  return (
    <section style={{ marginTop: 'var(--space-8)' }}>
      <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
        {BUCKET_LABELS[bucket]} ({projects.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {projects.map(p => <ProjectCard key={p.id} project={p} token={token} />)}
      </div>
    </section>
  )
}

function ProjectCard({ project: p, token, compact = false }: { project: BoardProject; token: string; compact?: boolean }) {
  const files: DownloadFile[] = p.approved.map(a => ({ id: a.id, name: fileName(a) }))
  const tally = tallyLine(p.tally)
  const shown = compact ? [] : p.approved.slice(0, THUMBS)
  const more = p.approved.length - shown.length

  return (
    // The id is what a project row on the home page links to; the margin keeps
    // the card clear of the sticky top bar when the browser jumps to it.
    <div id={`p-${p.id}`} className="card" style={{ scrollMarginTop: 72, padding: compact ? 'var(--space-3) var(--space-4)' : 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: compact ? 14 : 15, fontWeight: 700, color: 'var(--text-primary)' }}>{p.name}</span>
            {p.pageType && !compact && (
              <span style={{
                fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-raised)',
                border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px',
              }}>
                {p.pageType}
              </span>
            )}
          </div>

          {!compact && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {p.lpStage && <StagePill stage={normalizeStage(p.lpStage)} track="LP" />}
              {p.creativesStage && <StagePill stage={normalizeStage(p.creativesStage)} track="Creatives" />}
            </div>
          )}

          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            {!compact && <>{p.waiting}</>}
            {!compact && p.dueDate && ' · '}
            {p.late > 0 ? (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                {p.late} day{p.late === 1 ? '' : 's'} late{p.dueDate ? ` (due ${dueLabel(p.dueDate)})` : ''}
              </span>
            ) : p.dueDate ? (
              <span>{p.bucket === 'launched' ? 'Launch date' : 'Due'} {dueLabel(p.dueDate)}</span>
            ) : null}
          </p>
          {tally && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Creatives: {tally}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
          {p.lpUrl && /^https?:\/\//i.test(p.lpUrl) && (
            <a href={p.lpUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>
              Open landing page
            </a>
          )}
          {p.shareToken && (
            <a href={`/review/${p.shareToken}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>
              Open client review
            </a>
          )}
          {files.length > 0 && (
            <DownloadApproved
              token={token}
              files={files}
              zipName={safeName(p.name, 'project')}
              label={`Download approved (${files.length})`}
            />
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
          gap: 8, marginTop: 14,
        }}>
          {shown.map(a => <Thumb key={a.id} asset={a} token={token} />)}
          {more > 0 && (
            <div style={{
              aspectRatio: '4 / 5', borderRadius: 8, border: '1px dashed var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
              fontSize: 'var(--text-sm)', color: 'var(--text-muted)', padding: 6,
            }}>
              +{more} more in the download
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A small still of an approved file. Opens the real file in a new tab. */
function Thumb({ asset: a, token }: { asset: BoardAsset; token: string }) {
  const video = isVideoAsset(a)
  // The version the client approved: the published one when there is one.
  const src = video
    ? clientPosterOf(a, 600)
    : a.published_url && !a.published_url.includes('drive.google.com')
      ? a.published_url
      : resizeDriveThumb(a.thumbnail_url, 600) ?? driveThumb(a.drive_file_id, 600)
  return (
    <a
      href={`/api/status/${token}/file?asset=${a.id}`}
      target="_blank"
      rel="noopener noreferrer"
      title={a.name ?? 'Open file'}
      style={{
        position: 'relative', display: 'block', aspectRatio: '4 / 5', borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)', background: 'var(--surface-raised)',
      }}
    >
      {src && (
        <img
          src={src}
          alt={a.name ?? 'Approved creative'}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {video && (
        <span style={{
          position: 'absolute', right: 5, bottom: 5, fontSize: 10, fontWeight: 700, color: '#fff',
          background: 'rgba(0,0,0,0.65)', borderRadius: 4, padding: '1px 5px',
        }}>
          VIDEO
        </span>
      )}
    </a>
  )
}

/** The name a file gets in the zip. The route adds the right extension. */
function fileName(a: BoardAsset): string {
  return safeName(a.name, `creative-${a.id.slice(0, 8)}`)
}
