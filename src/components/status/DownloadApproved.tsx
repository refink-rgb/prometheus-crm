'use client'

// "Download approved" on the strategist status page. The .zip is built in the
// browser, one file request at a time, so it has no size ceiling and a slow
// file shows as progress rather than a hung button. Same approach as
// ApprovedFilesExport (BFCM and Evergreen).

import { useState } from 'react'
import { Download } from 'lucide-react'

export interface DownloadFile {
  id: string
  name: string
  /** Folder inside the zip: the project name, when one zip spans projects. */
  folder?: string
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
}
const stripExt = (s: string) => s.replace(/\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i, '')

export default function DownloadApproved({
  token,
  files,
  zipName,
  label,
  ariaLabel,
  primary = false,
}: {
  token: string
  files: DownloadFile[]
  /** File name of the .zip, without the extension. */
  zipName: string
  label: string
  /** The full name read by screen readers and AI agents, when the label is short. */
  ariaLabel?: string
  primary?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function download() {
    setError('')
    setBusy(`Downloading 0 of ${files.length}…`)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const used = new Set<string>()
      const missed: string[] = []
      let done = 0
      let added = 0

      // Numbered so the files keep the order the team arranged them in.
      const queue = files.map((file, index) => ({ file, index }))
      const pad = String(files.length).length
      const worker = async () => {
        for (;;) {
          const item = queue.shift()
          if (!item) return
          const { file, index } = item
          try {
            const res = await fetch(`/api/status/${token}/file?asset=${file.id}`)
            if (!res.ok) throw new Error(String(res.status))
            const blob = await res.blob()
            const ext = EXT[blob.type] ?? 'jpg'
            const stem = `${String(index + 1).padStart(pad, '0')}_${stripExt(file.name)}`
            const dir = file.folder ? `${file.folder}/` : ''
            let path = `${dir}${stem}.${ext}`
            for (let n = 2; used.has(path); n++) path = `${dir}${stem} (${n}).${ext}`
            used.add(path)
            zip.file(path, blob)
            added++
          } catch {
            missed.push(file.name)
          }
          done++
          setBusy(`Downloading ${done} of ${files.length}…`)
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))

      if (!added) { setError('Could not download any of the files. Try again.'); return }
      setBusy('Building the .zip…')
      // Images and videos are already compressed: store, don't deflate.
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${zipName}-approved-${added}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      if (missed.length) setError(`Left out (couldn’t download): ${missed.join(', ')}`)
    } catch {
      setError('Something went wrong. Reload and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 0 }}>
      <button
        type="button"
        className={primary ? 'btn-primary' : 'btn-secondary btn-sm'}
        aria-label={busy ? undefined : ariaLabel}
        disabled={!!busy || files.length === 0}
        onClick={() => void download()}
        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <Download size={primary ? 14 : 12} aria-hidden /> {busy ?? label}
      </button>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger)', maxWidth: 320, textAlign: 'right' }}>
          {error}
        </p>
      )}
    </div>
  )
}
