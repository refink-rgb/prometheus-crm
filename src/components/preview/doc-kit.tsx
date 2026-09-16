'use client'

// The parts every file panel shares: brand documents and project briefs.
// Each fix here was already paid for once in BrandDocuments (commit 7d6a42e).
// Keep them here so they are never paid for twice.

import { useEffect, useState, useSyncExternalStore } from 'react'
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
 * State that outlives the component showing it. A tab switch unmounts a panel,
 * but an upload or preview render started there keeps running. Keyed state lets
 * the remount show that work's progress and errors, and keeps its
 * one-at-a-time guard. Browser only: on the server a module-level map would be
 * shared by every request.
 */
class Cell<T> {
  private listeners = new Set<() => void>()
  constructor(private value: T) {}
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  get = () => this.value
  set = (v: T) => { this.value = v; for (const l of this.listeners) l() }
}
const cells = new Map<string, Cell<unknown>>()

/**
 * `initial` must be a module-level constant: it is also the server snapshot.
 * `get` reads the value at call time, for async work that outlives the render.
 */
export function useSharedState<T>(key: string, initial: T): { value: T; set: (v: T) => void; get: () => T } {
  const [own] = useState(() => new Cell(initial))
  let cell = own
  if (typeof window !== 'undefined') {
    const found = cells.get(key) as Cell<T> | undefined
    if (found) cell = found
    else cells.set(key, own as Cell<unknown>)
  }
  const value = useSyncExternalStore(cell.subscribe, cell.get, () => initial)
  return { value, set: cell.set, get: cell.get }
}

type QueueState = { running: boolean; busy: string | null; failures: string[] }
const IDLE_QUEUE: QueueState = { running: false, busy: null, failures: [] }

/**
 * Sequential uploads: five 30MB files in parallel is a stalled tab and five
 * half-written objects. `one` returns an error message, or null on success.
 * `key` names the queue, so a remounted panel finds its batch still running.
 */
export function useUploadQueue(key: string) {
  const q = useSharedState(`upload-queue:${key}`, IDLE_QUEUE)
  const [dragging, setDragging] = useState(false)
  const put = (patch: Partial<QueueState>) => q.set({ ...q.get(), ...patch })

  async function run(
    files: File[],
    one: (file: File, step: (label: string) => void) => Promise<string | null>,
  ): Promise<void> {
    if (!files.length) return
    if (q.get().running) {
      put({ failures: ['One upload at a time — wait for this batch to finish, then add the rest.'] })
      return
    }
    put({ running: true, busy: null, failures: [] })
    const errs: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const prefix = files.length > 1 ? `${i + 1} of ${files.length} · ` : ''
        const step = (label: string) => put({ busy: prefix + label })
        step(`Uploading ${file.name}…`)
        try {
          const err = await one(file, step)
          if (err) errs.push(`${file.name}: ${err}`)
        } catch (e) {
          errs.push(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed.'}`)
        }
      }
    } finally {
      put({ running: false, busy: null, failures: errs })
    }
  }

  const setFailures = (failures: string[]) => put({ failures })
  return { busy: q.value.busy, failures: q.value.failures, setFailures, dragging, setDragging, run }
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
