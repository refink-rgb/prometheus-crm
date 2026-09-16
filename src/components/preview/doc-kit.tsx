'use client'

// The parts every file panel shares: brand documents and project briefs.
// Each fix here was already paid for once in BrandDocuments (commit 7d6a42e).
// Keep them here so they are never paid for twice.

import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MB } from '@/lib/doc-files'

/** Read after mount only: matchMedia during render is a hydration mismatch. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return narrow
}

/**
 * Sequential uploads: five 30MB files in parallel is a stalled tab and five
 * half-written objects. `one` returns an error message, or null on success.
 */
export function useUploadQueue() {
  const running = useRef(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [failures, setFailures] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)

  async function run(
    files: File[],
    one: (file: File, step: (label: string) => void) => Promise<string | null>,
  ): Promise<void> {
    if (!files.length) return
    if (running.current) {
      setFailures(['One upload at a time — wait for this batch to finish, then add the rest.'])
      return
    }
    running.current = true
    setFailures([])
    const errs: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const prefix = files.length > 1 ? `${i + 1} of ${files.length} · ` : ''
        const step = (label: string) => setBusy(prefix + label)
        step(`Uploading ${file.name}…`)
        try {
          const err = await one(file, step)
          if (err) errs.push(`${file.name}: ${err}`)
        } catch (e) {
          errs.push(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed.'}`)
        }
      }
    } finally {
      running.current = false
      setBusy(null)
      setFailures(errs)
    }
  }

  return { busy, failures, setFailures, dragging, setDragging, run }
}
export type UploadQueue = ReturnType<typeof useUploadQueue>

/**
 * Re-wrap rather than pass { contentType }: uploadToSignedUrl IGNORES that
 * option for a File body and sends the File's own .type. Chrome on Windows
 * reports '' for .docx/.pptx, which the bucket's allowed_mime_types rejects.
 * Returns an error message or null.
 */
export async function uploadTyped(
  supabase: Pick<SupabaseClient, 'storage'>,
  bucket: string, path: string, token: string, file: File, type: string,
): Promise<string | null> {
  const body = file.type === type ? file : new File([file], file.name, { type })
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, body, { contentType: type, cacheControl: '3600' })
  return error ? error.message : null
}

export function DocDropZone({ queue, accept, title, hint, onFiles }: {
  queue: UploadQueue
  accept: string
  title: string
  hint: string
  onFiles: (files: File[]) => void
}) {
  const { busy, failures, setFailures, dragging, setDragging } = queue
  return (
    <>
      <label
        // Not while an upload runs: lighting up then discarding the drop told
        // the user their file was accepted when it was thrown away.
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          if (busy) { setFailures(['One upload at a time — wait for this batch to finish, then drop the rest.']); return }
          const f = Array.from(e.dataTransfer.files ?? [])
          if (f.length) onFiles(f)
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
          type="file" accept={accept} multiple disabled={!!busy} style={{ display: 'none' }}
          // Reset so re-picking the same file re-fires.
          onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f) }}
        />
        <span style={{ fontSize: 15 }}>⬆</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflowWrap: 'anywhere' }}>{busy ?? title}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</div>
        </div>
      </label>
      {failures.length > 0 && (
        <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--danger)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{failures.length} failed</div>
          {failures.map(f => <div key={f} style={{ overflowWrap: 'anywhere' }}>{f}</div>)}
        </div>
      )}
    </>
  )
}

export function DocFrame({ url, title, narrow, height }: { url: string; title: string; narrow: boolean; height: number }) {
  // iOS Safari renders page one of a framed PDF and stops. A phone gets the link.
  if (narrow) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Phone browsers will not render this in place.{' '}
        <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>Open {title} ↗</a>
      </div>
    )
  }
  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>Open full screen ↗</a>
      </div>
      <iframe
        src={url}
        title={title}
        // allow-scripts: Chrome's PDF viewer renders blank without it.
        // allow-same-origin gives the frame ITS OWN origin (supabase.co), not ours.
        // No allow-top-navigation: a document must not move the tab.
        sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height, maxHeight: '75vh', border: '1px solid var(--border)', borderRadius: 8, background: '#ffffff', display: 'block' }}
      />
    </>
  )
}

export const fmtSize = (b: number): string =>
  b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

// UTC on purpose: server-rendered then hydrated, and a near-midnight timestamp
// formats as a different day in hnd1 than in a Los Angeles browser.
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export const miniLink: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none',
  border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
}

export const miniBtn: React.CSSProperties = {
  fontSize: 12, width: 26, height: 26, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
  border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--danger)',
}
