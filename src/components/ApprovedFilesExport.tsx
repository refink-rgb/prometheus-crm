'use client'

// "Approved files" panel, shared by the BFCM calibration page and an Evergreen ad.
// Two ways out: a Drive folder link (made inside the folder the team synced from),
// or a .zip the browser builds from the CRM's own copies (always works).

import { useState } from 'react'
import { Copy, Download, ExternalLink, FolderOpen } from 'lucide-react'
import { listApprovedFiles, sendApprovedFileToDrive, startApprovedDriveFolder, type ApprovedKind } from '@/lib/approved-actions'

type Props = {
  kind: ApprovedKind
  /** The BFCM plan slug, or the Evergreen ad id. */
  itemKey: string
  /** Used for the .zip's name. */
  label: string
  approvedCount: number
  hasDriveFolder: boolean
}

type DriveResult = { url: string; copied: number; shortcuts: number; already: number; removed: number; failed: string[] }
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'approved'

export default function ApprovedFilesExport({ kind, itemKey, label, approvedCount, hasDriveFolder }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [drive, setDrive] = useState<DriveResult | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const none = approvedCount === 0

  async function getDriveLink() {
    setError(''); setDrive(null); setCopiedLink(false)
    setBusy('Preparing the Approved folder…')
    try {
      const start = await startApprovedDriveFolder(kind, itemKey)
      if (!start.ok) { setError(start.error); return }
      const out: DriveResult = { url: start.folderUrl, copied: 0, shortcuts: 0, already: start.alreadyThere, removed: start.removed, failed: [] }
      for (const [i, file] of start.todo.entries()) {
        setBusy(`Adding ${i + 1} of ${start.todo.length}: ${file.name}`)
        const r = await sendApprovedFileToDrive(kind, itemKey, file.id)
        if (!r.ok) out.failed.push(r.error)
        else if (r.how === 'shortcut') out.shortcuts++
        else if (r.how === 'already') out.already++
        else out.copied++
      }
      setDrive(out)
    } catch {
      setError('Something went wrong. Reload and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function downloadZip() {
    setError('')
    setBusy('Listing approved files…')
    try {
      const list = await listApprovedFiles(kind, itemKey)
      if (!list.ok) { setError(list.error); return }
      if (!list.files.length) { setError('Nothing is approved yet.'); return }
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const used = new Set<string>()
      let added = 0
      const missed: string[] = []
      for (const [i, f] of list.files.entries()) {
        setBusy(`Downloading ${i + 1} of ${list.files.length}: ${f.name}`)
        try {
          const res = await fetch(f.url)
          if (!res.ok) throw new Error(String(res.status))
          let path = `${f.folder}/${f.name}`
          for (let n = 2; used.has(path); n++) path = `${f.folder}/${f.name.replace(/(\.[^.]+)?$/, ` (${n})$1`)}`
          used.add(path)
          zip.file(path, await res.blob())
          added++
        } catch { missed.push(f.name) }
      }
      if (!added) { setError('Could not download any of the files. Try again.'); return }
      setBusy('Building the .zip…')
      // Already-compressed images and videos: store, don't deflate (much faster, same size).
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${safe(label)}-approved-${added}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      if (missed.length) setError(`Left out (couldn’t download): ${missed.join(', ')}`)
    } catch {
      setError('Something went wrong. Reload and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function copyLink() {
    if (!drive) return
    try { await navigator.clipboard.writeText(drive.url); setCopiedLink(true) } catch { setCopiedLink(false) }
  }

  const muted: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={muted}>
        {none ? 'Nothing is approved by the client yet.' : `${plural(approvedCount, 'file')} approved by the client.`}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary btn-sm" disabled={none || !!busy || !hasDriveFolder} onClick={() => void getDriveLink()}
          title={hasDriveFolder ? 'Put the approved files in an Approved folder in Drive' : 'Sync a Drive folder first'}>
          <FolderOpen size={12} aria-hidden /> Get Drive link
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={none || !!busy} onClick={() => void downloadZip()}>
          <Download size={12} aria-hidden /> Download .zip
        </button>
      </div>
      {!hasDriveFolder && !none && <p style={muted}>Drive link: sync this from a Drive folder first. The Approved folder is made inside it.</p>}
      {busy && <p style={muted} role="status">{busy}</p>}
      {drive && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={drive.url} aria-label="Approved folder link" onFocus={e => e.target.select()}
              style={{ flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 12 }} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => void copyLink()}><Copy size={12} aria-hidden /> {copiedLink ? 'Copied' : 'Copy'}</button>
            <a href={drive.url} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm" title="Open in Drive"><ExternalLink size={12} aria-hidden /></a>
          </div>
          <p style={muted}>
            {[
              drive.copied && `${plural(drive.copied, 'file')} added`,
              drive.shortcuts && `${plural(drive.shortcuts, 'shortcut')} to the team’s originals`,
              drive.already && `${drive.already} already there`,
              drive.removed && `${drive.removed} no longer approved, removed`,
            ].filter(Boolean).join(' · ') || 'Up to date.'}
            {' '}The link opens for anyone who can open the synced folder.
          </p>
          {drive.shortcuts > 0 && <p style={muted}>This Drive folder won’t store copies made by the CRM, so some files are shortcuts. Opening one opens the original; for a download of everything, use the .zip.</p>}
        </div>
      )}
      {drive?.failed.length ? <p style={{ ...muted, color: 'var(--danger)' }}>{drive.failed.join(' ')}</p> : null}
      {error && <p style={{ ...muted, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
