'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  createProjectBriefUploadUrl, attachProjectBrief, removeProjectBrief, getProjectBriefUrl,
  createProjectBriefImageUploadUrls, saveProjectBriefPreviews,
} from '@/lib/actions'
import {
  BRIEF_ACCEPT, BRIEF_BUCKET, BRIEF_TYPES, MAX_BRIEF_BYTES, MAX_PDF_PREVIEW_PAGES,
  IMAGE_FULL_PX, IMAGE_THUMB_PX, resolveBriefType, isReadingStale,
} from '@/lib/project-briefs'
import { MB } from '@/lib/doc-files'
import type { ProjectBrief } from '@/lib/types'
import { useNarrow, useUploadQueue, useSharedState, uploadTyped, DocDropZone, fmtSize, fmtDate, miniLink, miniBtn } from './doc-kit'
import { renderPdfPreviews, pdfErrorMessage } from './render-pdf-pages'
import BriefReader from './BriefReader'

// Creative briefs on a project: upload, download, AI read, and the read itself.
// Bytes go browser -> Storage on a signed URL (a brief is 1-50MB, an action
// body 1MB). The AI read runs server-side in a route handler; PDF page previews
// are drawn here, in the uploader's own tab, while they are looking at it.

type Slot = { path: string; token: string }
type Previews = { id: string; label: string } | null
const NO_PREVIEWS: Previews = null
const NO_ID: string | null = null

export default function ProjectBriefs({ projectId, brandId, briefs, serverNow }: {
  projectId: string
  brandId: string
  briefs: ProjectBrief[]
  /** Date.now() on the server at render: `extraction_started_at` is server time. */
  serverNow: number
}) {
  const router = useRouter()
  // Shared, not local: the Creatives tab unmounts this panel on a tab switch,
  // and the upload or preview render it started keeps running. On return, the
  // panel shows that work and its one-at-a-time guards still hold.
  const queue = useUploadQueue(`briefs:${projectId}`)
  const previewsCell = useSharedState(`brief-previews:${projectId}`, NO_PREVIEWS)
  const previews = previewsCell.value
  // The brief this tab is still uploading or drawing previews for.
  const workingCell = useSharedState(`brief-working:${projectId}`, NO_ID)
  const narrow = useNarrow()
  const [openId, setOpenId] = useState<string | null>(null)
  const [rowErr, setRowErr] = useState<{ id: string; message: string } | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  // null until mounted: staleness depends on the clock, and computing it
  // during the server render is a hydration mismatch.
  const [now, setNow] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    // Server time, not this computer's: a clock a few minutes fast would call a
    // live read stopped and never poll for its result. The skew includes the
    // round trip, a few seconds against a 5½-minute threshold.
    const skew = serverNow - Date.now()
    const tick = () => setNow(Date.now() + skew)
    tick()
    const t = setInterval(tick, 15_000)
    return () => clearInterval(t)
  }, [serverNow])

  // The read finishes on the server after the route answered; nothing pushes
  // the result here. Poll while a read is live, stop when none is.
  const liveRead = now !== null && briefs.some(b => b.extraction_status === 'reading' && !isReadingStale(b, now))
  useEffect(() => {
    if (!liveRead) return
    const t = setInterval(() => router.refresh(), 6000)
    return () => clearInterval(t)
  }, [liveRead, router])

  async function startRead(briefId: string): Promise<string | null> {
    setStarting(briefId)
    try {
      const res = await fetch(`/api/project-briefs/${briefId}/read`, { method: 'POST' })
      if (res.status === 409) return 'Already being read. The result shows here when it finishes.'
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !body?.ok) return body?.error ?? `Could not start the read (HTTP ${res.status}).`
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not start the read.'
    } finally {
      setStarting(null)
      router.refresh()
    }
  }

  async function makePreviews(
    briefId: string,
    source: { data: ArrayBuffer } | { url: string },
    onLabel: (label: string) => void,
  ): Promise<string | null> {
    const supabase = createClient()
    let slots = new Map<number, { full: Slot; thumb: Slot }>()
    const saved: { n: number; w: number; h: number }[] = []
    try {
      onLabel('Opening the PDF…')
      const { pageCount, ext } = await renderPdfPreviews({
        source, maxPages: MAX_PDF_PREVIEW_PAGES, fullPx: IMAGE_FULL_PX, thumbPx: IMAGE_THUMB_PX,
        prepare: async (pages, ext) => {
          const r = await createProjectBriefImageUploadUrls(briefId, pages, ext)
          if (!r.ok) throw new Error(r.error)
          slots = new Map(r.uploads.map(u => [u.n, { full: u.full, thumb: u.thumb }]))
        },
        onPage: async page => {
          const slot = slots.get(page.n)
          if (!slot) return
          const bucket = supabase.storage.from(BRIEF_BUCKET)
          const [a, b] = await Promise.all([
            bucket.uploadToSignedUrl(slot.full.path, slot.full.token, page.full, { contentType: page.full.type }),
            bucket.uploadToSignedUrl(slot.thumb.path, slot.thumb.token, page.thumb, { contentType: page.thumb.type }),
          ])
          if (!a.error && !b.error) saved.push({ n: page.n, w: page.w, h: page.h })
        },
        onProgress: (done, total) => onLabel(`Page previews ${done} of ${total} — keep this tab open`),
      })
      const r = await saveProjectBriefPreviews(briefId, projectId, brandId, { ok: true, pageCount, ext, pages: saved })
      return r.ok ? null : r.error
    } catch (e) {
      const message = pdfErrorMessage(e)
      await saveProjectBriefPreviews(briefId, projectId, brandId, { ok: false, error: message }).catch(() => null)
      return message
    } finally {
      router.refresh()
    }
  }

  function upload(files: File[]) {
    const supabase = createClient()
    void queue.run(files, async (file, step) => {
      const type = resolveBriefType(file)
      if (!type) return 'not an accepted type — PDF, .pptx, .docx, .txt or a PNG/JPG/WebP image. Google Docs or Slides: File, Download, PDF.'
      if (file.size === 0) return 'the file is empty.'
      if (file.size > MAX_BRIEF_BYTES) {
        return `${(file.size / MB).toFixed(1)}MB — the limit is ${MAX_BRIEF_BYTES / MB}MB. Export a lighter PDF (compress the images).`
      }

      const signed = await createProjectBriefUploadUrl(projectId, type, file.size)
      if (!signed.ok) return signed.error
      const upErr = await uploadTyped(supabase, BRIEF_BUCKET, signed.path, signed.token, file, type)
      if (upErr) return upErr

      const attached = await attachProjectBrief(projectId, brandId, {
        briefId: signed.briefId, path: signed.path, fileName: file.name, contentType: type, byteSize: file.size,
      })
      if (!attached.ok) {
        // Bytes with no row are an orphan nobody can see. Take them back.
        await supabase.storage.from(BRIEF_BUCKET).remove([signed.path])
        return attached.error
      }
      router.refresh()

      workingCell.set(attached.briefId)
      let readErr: string | null
      let previewErr: string | null = null
      try {
        step(`Starting the AI read — ${file.name}`)
        readErr = await startRead(attached.briefId)
        if (type === 'application/pdf') {
          previewErr = await makePreviews(attached.briefId, { data: await file.arrayBuffer() }, label => step(`${label} — ${file.name}`))
        }
      } finally {
        workingCell.set(null)
      }

      const problems = [
        readErr && `uploaded, but the AI read did not start: ${readErr}`,
        previewErr && `uploaded, but ${previewErr.charAt(0).toLowerCase()}${previewErr.slice(1)}`,
      ].filter(Boolean)
      return problems.length ? problems.join(' · ') : null
    }).then(() => router.refresh())
  }

  // try/catch in every async transition: a rejected server action (Wi-Fi
  // blip) is rethrown from the transition and replaces the whole page with
  // Next's client-side exception screen.
  function download(b: ProjectBrief) {
    setRowErr(null)
    startTransition(async () => {
      try {
        const r = await getProjectBriefUrl(b.id, projectId, 'download')
        if (!r.ok) { setRowErr({ id: b.id, message: r.error }); return }
        // Storage's ?download= sends Content-Disposition: attachment; a
        // cross-origin <a download> would just open the file.
        window.location.href = r.url
      } catch {
        setRowErr({ id: b.id, message: 'Could not reach the server. Check the connection, then Download again.' })
      }
    })
  }

  function remove(b: ProjectBrief) {
    if (!window.confirm(`Remove ${b.file_name}? The file, its previews and the AI read are deleted for everyone.`)) return
    setRowErr(null)
    startTransition(async () => {
      try {
        const r = await removeProjectBrief(b.id, projectId, brandId)
        if (!r.ok) { setRowErr({ id: b.id, message: r.error }); return }
        if (openId === b.id) setOpenId(null)
        router.refresh()
      } catch {
        setRowErr({ id: b.id, message: 'Could not reach the server. Check the connection, then remove it again.' })
      }
    })
  }

  async function reread(b: ProjectBrief) {
    setRowErr(null)
    const err = await startRead(b.id)
    if (err) setRowErr({ id: b.id, message: err })
  }

  async function remakePreviews(b: ProjectBrief) {
    // get(), not the render's copy: a remounted panel must see a render that
    // an earlier mount started.
    if (previewsCell.get() || queue.busy) return
    setRowErr(null)
    previewsCell.set({ id: b.id, label: 'Fetching the PDF…' })
    try {
      const r = await getProjectBriefUrl(b.id, projectId, 'view')
      if (!r.ok) { setRowErr({ id: b.id, message: r.error }); return }
      const err = await makePreviews(b.id, { url: r.url }, label => previewsCell.set({ id: b.id, label }))
      if (err) setRowErr({ id: b.id, message: err })
    } catch {
      setRowErr({ id: b.id, message: 'Could not reach the server. Check the connection, then Make page previews again.' })
    } finally {
      previewsCell.set(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
        Brief files{briefs.length ? ` · ${briefs.length}` : ''}
      </div>

      <DocDropZone
        queue={queue}
        accept={BRIEF_ACCEPT}
        title="Upload creative brief"
        hint={`The client's brief for this project · drop files or click · PDF, .pptx, .docx, .txt, PNG/JPG · up to ${MAX_BRIEF_BYTES / MB}MB · AI reads it after upload`}
        onFiles={upload}
      />

      {briefs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No brief files yet. From Google Docs or Slides: File, Download, PDF — then drop it here.
        </div>
      ) : briefs.map(b => {
        const spec = BRIEF_TYPES[b.mime_type]
        const stale = now !== null && isReadingStale(b, now)
        const status = statusOf(b, stale, starting === b.id)
        const isOpen = openId === b.id
        const isPdf = b.mime_type === 'application/pdf'
        // Pages this tab is still uploading would land after the delete. The AI
        // read is different: the server cleans up after itself.
        const drawing = workingCell.value === b.id || previews?.id === b.id
        return (
          <div key={b.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setOpenId(isOpen ? null : b.id)}
                aria-expanded={isOpen}
                style={{ ...miniLink, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 160, textAlign: 'left' }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>
                  {spec?.label ?? 'FILE'}
                </span>
                <span title={b.file_name} style={{ fontSize: 12, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.file_name}
                </span>
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: status.color, flexShrink: 0 }}>{status.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                {fmtSize(b.byte_size)} · {fmtDate(b.created_at)}{b.uploaded_by_name ? ` · ${b.uploaded_by_name}` : ''}
              </span>
              <button onClick={() => download(b)} style={miniLink}>Download</button>
              <button
                onClick={() => void reread(b)}
                disabled={status.busy}
                style={{ ...miniLink, opacity: status.busy ? 0.4 : 1, cursor: status.busy ? 'default' : 'pointer' }}
              >
                {b.extraction_status === 'pending' ? 'Read with AI' : 'Re-read'}
              </button>
              <button
                onClick={() => remove(b)}
                disabled={drawing}
                title={drawing ? 'Wait until this upload and its page previews finish' : 'Remove'}
                aria-label={`Remove ${b.file_name}`}
                style={{ ...miniBtn, opacity: drawing ? 0.4 : 1, cursor: drawing ? 'default' : 'pointer' }}
              >✕</button>
            </div>

            {/* Outside the reader on purpose: a collapsed row must still show why it failed. */}
            {b.extraction_status === 'failed' && b.extraction_error && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4, overflowWrap: 'anywhere' }}>{b.extraction_error}</div>
            )}
            {rowErr?.id === b.id && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4, overflowWrap: 'anywhere' }}>{rowErr.message}</div>
            )}
            {previews?.id === b.id && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{previews.label}</div>
            )}

            {isOpen && (
              <BriefReader
                brief={b}
                projectId={projectId}
                narrow={narrow}
                onMakePreviews={isPdf && !previews && !queue.busy ? () => void remakePreviews(b) : null}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function statusOf(b: ProjectBrief, stale: boolean, starting: boolean): { label: string; color: string; busy: boolean } {
  if (starting) return { label: 'Starting…', color: 'var(--text-muted)', busy: true }
  switch (b.extraction_status) {
    case 'reading':
      return stale
        ? { label: 'Read stopped', color: 'var(--danger)', busy: false }
        : { label: 'AI reading… up to 4 min', color: 'var(--accent)', busy: true }
    case 'done':
      return { label: `Read by AI${b.extracted_at ? ` · ${fmtDate(b.extracted_at)}` : ''}`, color: 'var(--success)', busy: false }
    case 'failed':
      return { label: 'AI read failed', color: 'var(--danger)', busy: false }
    default:
      return { label: 'Not read yet', color: 'var(--text-muted)', busy: false }
  }
}
