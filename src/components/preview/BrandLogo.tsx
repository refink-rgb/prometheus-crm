'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BRAND_LOGO_ACCEPT, brandLogoDownloadUrl, uploadBrandLogoFile } from '@/lib/brand-logo-upload'

// The brand's logo, top of the Brand section. Saved on the brand, so every
// project of the brand shows the same file; replacing it here replaces it
// everywhere. Download stays on the page (no new tab).

export default function BrandLogo({ brandId, brandName, logoUrl }: {
  brandId: string
  brandName: string
  logoUrl: string | null
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)
  const [large, setLarge] = useState(false)

  async function upload(file: File | undefined) {
    if (!file || busy) return
    setBusy(true); setErr('')
    try {
      const e = await uploadBrandLogoFile(brandId, file)
      if (e) setErr(e); else router.refresh()
    } catch {
      setErr('Could not reach the server. Check the connection, then try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const size = large ? 280 : 96
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files?.[0]) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: 12, borderRadius: 10,
        border: `1px dashed ${dragging ? 'var(--accent)' : 'transparent'}`,
        background: dragging ? 'var(--accent-muted)' : 'none',
      }}
    >
      <button
        type="button"
        onClick={() => (logoUrl ? setLarge(v => !v) : input.current?.click())}
        title={logoUrl ? (large ? 'Smaller' : 'Larger') : 'Upload logo'}
        style={{
          width: size, height: size, flexShrink: 0, padding: 8, borderRadius: 10, cursor: 'pointer',
          border: '1px solid var(--border)', display: 'grid', placeItems: 'center',
          // Checkerboard: a white or transparent logo is still visible.
          backgroundColor: 'var(--surface-2)',
          backgroundImage: logoUrl
            ? 'linear-gradient(45deg, var(--border) 25%, transparent 25%), linear-gradient(-45deg, var(--border) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--border) 75%), linear-gradient(-45deg, transparent 75%, var(--border) 75%)'
            : 'none',
          backgroundSize: '16px 16px', backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          transition: 'width 0.15s, height 0.15s',
        }}
      >
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt={`${brandName} logo`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No logo</span>}
      </button>

      <div style={{ minWidth: 200, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input ref={input} type="file" accept={BRAND_LOGO_ACCEPT} style={{ display: 'none' }} onChange={e => void upload(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            style={{
              fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
              border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)',
            }}
          >{busy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}</button>
          {logoUrl && (
            <a
              href={brandLogoDownloadUrl(logoUrl, brandName)}
              download
              style={{
                fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, textDecoration: 'none',
                border: '1px solid var(--border-strong)', color: 'var(--text-primary)',
              }}
            >Download</a>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          Saved on {brandName}: every project uses this logo. PNG, SVG, JPG or WebP · up to 10MB · or drop it here.
        </div>
        {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{err}</div>}
      </div>
    </div>
  )
}
