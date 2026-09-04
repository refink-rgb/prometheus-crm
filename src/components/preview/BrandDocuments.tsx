'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  createBrandDocumentUploadUrl, attachBrandDocument,
  removeBrandDocument, getBrandDocumentUrl,
} from '@/lib/actions'
import {
  BRAND_DOC_ACCEPT, BRAND_DOC_BUCKET, BRAND_DOC_TYPES,
  MAX_BRAND_DOC_BYTES, MB, resolveDocType,
} from '@/lib/brand-docs'
import type { BrandDocument } from '@/lib/types'

// The second half of the brand guidelines panel: the client's actual files.
//
// The text box answers "what is the rule"; this answers "send me the brand
// book". Bytes go browser -> Storage on a signed URL and never through a Server
// Action — a brand book is 5-40MB and the action body cap is 1MB, which is the
// exact thing that broke the batch creative uploader in August.

export default function BrandDocuments({
  brandId, projectId, documents, compact = false,
}: {
  brandId: string
  /** Absent on the brand page, which has no project to revalidate. */
  projectId?: string
  documents: BrandDocument[]
  /** The Creatives-tab copy: same list, shorter viewer. */
  compact?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<{ done: number; total: number; name: string } | null>(null)
  const [failures, setFailures] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  // Keyed to the row they belong to. As one shared pair these mis-attributed
  // constantly: click View on A then B before A returns and B's row rendered
  // A's document under B's name; a download error for B painted inside A's
  // open viewer; and an Office row, which has no viewer at all, had nowhere to
  // show a download error whatsoever.
  const [openId, setOpenId] = useState<string | null>(null)
  const [frame, setFrame] = useState<{ id: string; url: string } | null>(null)
  const [rowErr, setRowErr] = useState<{ id: string; message: string } | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [, startTransition] = useTransition()

  // Read after mount only. This is a client component inside a server-rendered
  // page, and matchMedia during render is a hydration mismatch. Safe to start
  // false: the viewer is closed on first paint, so `narrow` is already correct
  // by the time anything depends on it.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Sequential, like the batch creative uploader: five 30MB files in parallel is
  // a stalled tab and five half-written objects.
  async function upload(files: File[]) {
    if (!files.length || busy) return
    setFailures([])
    const errs: string[] = []
    const supabase = createClient()

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setBusy({ done: i, total: files.length, name: file.name })

      const type = resolveDocType(file)
      if (!type) { errs.push(`${file.name}: not an accepted file type — PDF, .docx, .pptx, .xlsx or .txt.`); continue }
      if (file.size === 0) { errs.push(`${file.name}: the file is empty.`); continue }
      if (file.size > MAX_BRAND_DOC_BYTES) {
        errs.push(`${file.name}: ${(file.size / MB).toFixed(1)}MB — the limit is ${MAX_BRAND_DOC_BYTES / MB}MB.`)
        continue
      }

      try {
        const signed = await createBrandDocumentUploadUrl(brandId, type, file.size)
        if (!signed.ok) { errs.push(`${file.name}: ${signed.error}`); continue }

        // Re-wrap rather than pass { contentType }. uploadToSignedUrl IGNORES
        // that option for a File body — it sends the File's own .type — and
        // Chrome on Windows reports '' for a .docx, which is the exact case
        // resolveDocType's extension fallback exists to rescue. An empty type
        // is then rejected by the bucket's allowed_mime_types, so the upload
        // that the UI had already accepted fails on the wire. A Blob built
        // around the same bytes carries the type we resolved.
        const body = file.type === type
          ? file
          : new File([file], file.name, { type })

        const { error } = await supabase.storage
          .from(BRAND_DOC_BUCKET)
          .uploadToSignedUrl(signed.path, signed.token, body, { contentType: type, cacheControl: '3600' })
        if (error) { errs.push(`${file.name}: ${error.message}`); continue }

        const attached = await attachBrandDocument(
          brandId,
          { path: signed.path, fileName: file.name, contentType: type, byteSize: file.size },
          projectId,
        )
        if (!attached.ok) { errs.push(`${file.name}: ${attached.error}`); continue }
      } catch (e) {
        errs.push(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed.'}`)
      }
    }

    setBusy(null)
    setFailures(errs)
    router.refresh()
  }

  function toggleView(d: BrandDocument) {
    if (openId === d.id) { setOpenId(null); setFrame(null); return }
    setOpenId(d.id); setFrame(null); setRowErr(null)
    startTransition(async () => {
      const r = await getBrandDocumentUrl(d.id, 'view')
      // Stamped with the id it was fetched for, so a slow reply for a row the
      // user has already moved off simply does not match and is ignored.
      if (r.ok) setFrame({ id: d.id, url: r.url })
      else setRowErr({ id: d.id, message: r.error })
    })
  }

  function download(d: BrandDocument) {
    setRowErr(null)
    startTransition(async () => {
      const r = await getBrandDocumentUrl(d.id, 'download')
      if (!r.ok) { setRowErr({ id: d.id, message: r.error }); return }
      // A cross-origin <a download> does NOT force a download: the attribute is
      // honoured only for same-origin URLs, so the browser would just navigate
      // and open the PDF in its viewer. What works is Storage's own ?download=
      // parameter (added by getBrandDocumentUrl), which makes the SERVER send
      // Content-Disposition: attachment — and navigating to an attachment
      // response downloads without unloading this page.
      window.location.href = r.url
    })
  }

  function remove(d: BrandDocument) {
    if (!window.confirm(`Remove ${d.file_name}? The file is deleted for everyone.`)) return
    startTransition(async () => {
      const r = await removeBrandDocument(d.id, brandId, projectId)
      if (!r.ok) { setRowErr({ id: d.id, message: r.error }); return }
      if (openId === d.id) { setOpenId(null); setFrame(null) }
      router.refresh()
    })
  }

  return (
    <section style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
        Documents{documents.length ? ` · ${documents.length}` : ''}
      </div>

      {/* Click or drop. Hidden input inside a label, the same idiom the creative
          uploader uses; the drop handlers sit on the label so the whole target
          accepts a drag. */}
      <label
        // Not while an upload is running: lighting up and then discarding the
        // drop told the user their file was accepted when it was thrown away.
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          if (busy) { setFailures(['One upload at a time — wait for this batch to finish, then drop the rest.']); return }
          const f = Array.from(e.dataTransfer.files ?? [])
          if (f.length) void upload(f)
        }}
        style={{
          textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 10,
          border: `1px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: dragging ? 'var(--accent-muted)' : 'none',
          borderRadius: 10, cursor: busy ? 'wait' : 'pointer',
        }}
      >
        <input
          type="file"
          accept={BRAND_DOC_ACCEPT}
          multiple
          disabled={!!busy}
          style={{ display: 'none' }}
          // Reset so re-picking the same file re-fires.
          onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void upload(f) }}
        />
        <span style={{ fontSize: 15 }}>⬆</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            {busy ? `Uploading ${busy.name} — ${busy.done + 1} of ${busy.total}…` : 'Add a document'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Drop files here or click · PDF, .docx, .pptx, .xlsx, .txt · up to {MAX_BRAND_DOC_BYTES / MB}MB each
          </div>
        </div>
      </label>

      {failures.length > 0 && (
        <div style={{ marginBottom: 8, fontSize: 11, color: '#EF4444' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{failures.length} failed</div>
          {failures.map(f => <div key={f}>{f}</div>)}
        </div>
      )}

      {documents.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No documents yet — the brand book, a type specimen, a signed style guide.
        </div>
      ) : documents.map(d => {
        const spec = BRAND_DOC_TYPES[d.mime_type]
        const isOpen = openId === d.id
        return (
          <div key={d.id} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>
                {spec?.label ?? 'FILE'}
              </span>
              <span title={d.file_name} style={{ flex: 1, minWidth: 120, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.file_name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                {fmtSize(d.byte_size)} · {fmtDate(d.created_at)}
                {d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}
              </span>

              {spec?.inline ? (
                <button onClick={() => toggleView(d)} aria-expanded={isOpen} style={miniLink}>
                  {isOpen ? '▾ Hide' : '▸ View'}
                </button>
              ) : (
                // No View control at all for .docx/.pptx/.xlsx. An iframe at one
                // is a blank box in Chrome and a save prompt in Safari; a
                // control that cannot work is worse than no control. The usual
                // workaround — Microsoft's or Google's web viewer — needs a
                // PUBLICLY fetchable URL, which is exactly what this private
                // bucket refuses to have.
                <span
                  title="Word, PowerPoint and Excel have no in-browser viewer — download to open."
                  style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}
                >
                  opens in {spec?.opensIn ?? 'its app'}
                </span>
              )}

              <button onClick={() => download(d)} style={miniLink}>Download</button>
              <button onClick={() => remove(d)} title="Remove" aria-label={`Remove ${d.file_name}`} style={miniBtn}>✕</button>
            </div>

            {/* Outside the viewer block on purpose: an Office row has no viewer,
                so an error rendered in there would never be seen. */}
            {rowErr?.id === d.id && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{rowErr.message}</div>
            )}

            {isOpen && (
              <div style={{ marginTop: 8 }}>
                {frame?.id !== d.id && rowErr?.id !== d.id && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Opening…</div>
                )}
                {frame?.id === d.id && (narrow ? (
                  // iOS Safari renders page one of a framed PDF and stops, or
                  // shows nothing at all. A phone gets the link, not a lie.
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Phone browsers will not render a PDF in place.{' '}
                    <a href={frame.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      Open {d.file_name} ↗
                    </a>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 6 }}>
                      <a href={frame.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                        Open full screen ↗
                      </a>
                    </div>
                    <iframe
                      src={frame.url}
                      title={d.file_name}
                      // allow-scripts because Chrome's built-in PDF viewer is
                      // itself an HTML/JS surface and renders blank without it;
                      // allow-same-origin gives the frame ITS OWN origin
                      // (supabase.co), never ours, so it still cannot touch this
                      // page. No allow-top-navigation: a document must not be
                      // able to move the tab.
                      sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
                      referrerPolicy="no-referrer"
                      style={{
                        width: '100%', height: compact ? 480 : 760, maxHeight: '75vh',
                        border: '1px solid var(--border)', borderRadius: 8,
                        background: '#ffffff', display: 'block',
                      }}
                    />
                  </>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

const fmtSize = (b: number): string =>
  b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

// timeZone UTC on purpose. This component is server-rendered and then hydrated,
// and a timestamp near midnight formats as a different day on a Vercel box than
// in a Los Angeles browser — which is a hydration mismatch.
const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const miniLink: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none',
  border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
}

const miniBtn: React.CSSProperties = {
  fontSize: 12, width: 26, height: 26, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
  border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--danger)',
}
