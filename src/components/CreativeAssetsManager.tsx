'use client'

import { useState } from 'react'
import Image from 'next/image'
import { syncDriveImages, toggleAssetVisibility, applyAiEdits, approveAndPublishRevision, publishAssets } from '@/lib/actions'
import { useRouter } from 'next/navigation'
import type { CreativeAsset, ProjectComment } from '@/lib/types'

const QUALITY_OPTIONS: Array<{ value: 'low' | 'medium' | 'high'; label: string; price: string }> = [
  { value: 'low',    label: 'Low',    price: '$0.011' },
  { value: 'medium', label: 'Medium', price: '$0.042' },
  { value: 'high',   label: 'High',   price: '$0.167' },
]

// ─── Internal lightbox ───────────────────────────────────────────────────────

function InternalLightbox({
  asset,
  comments,
  projectId,
  brandId,
  onClose,
  onRevisionApplied,
}: {
  asset: CreativeAsset
  comments: ProjectComment[]
  projectId: string
  brandId: string
  onClose: () => void
  onRevisionApplied: (assetId: string, revisionUrl: string) => void
}) {
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [activePin, setActivePin] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(!!asset.client_visible && (!asset.revision_url || asset.published_url === asset.revision_url))

  async function handlePublish() {
    if (!confirm('Publish this revision to the client? They will see the revised image on the review link.')) return
    setPublishing(true)
    try {
      await approveAndPublishRevision(asset.id, projectId, brandId)
      setPublished(true)
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const hasComments = comments.length > 0
  const hasRevision = !!asset.revision_url
  const mainImage = hasRevision ? asset.revision_url! : `https://drive.google.com/thumbnail?id=${asset.drive_file_id}&sz=w2048`
  const originalThumb = hasRevision ? `https://drive.google.com/thumbnail?id=${asset.drive_file_id}&sz=w200` : null

  const pinnedComments = comments.filter(c => c.pin_x != null)
  const pinIndex = (c: ProjectComment) => pinnedComments.findIndex(p => p.id === c.id) + 1

  async function handleGenerate() {
    const price = QUALITY_OPTIONS.find(q => q.value === quality)!.price
    if (!confirm(`Generate AI revision at ${quality} quality (${price}/image)?`)) return
    setGenerating(true)
    setGenError('')
    try {
      const { revisionUrl } = await applyAiEdits(asset.id, projectId, brandId, quality)
      onRevisionApplied(asset.id, revisionUrl)
      setPublished(false) // a fresh edit is internal until you publish it
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* ── Image area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
          background: 'rgba(0,0,0,0.7)', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer' }}>←</button>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 }}>
            {asset.name ?? 'Creative asset'}
            {hasRevision && (
              <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-muted)', padding: '2px 8px', borderRadius: 4 }}>
                ✦ AI Revised
              </span>
            )}
          </span>
          <a
            href={`https://drive.google.com/uc?export=view&id=${asset.drive_file_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}
          >
            Original ↗
          </a>
        </div>

        {/* Image display */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 24px 24px 24px', position: 'relative' }}>
          {/* Main image (revision or original) */}
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mainImage}
              alt={asset.name ?? 'Creative'}
              decoding="async"
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 130px)',
                objectFit: 'contain',
                display: 'block',
                borderRadius: 8,
              }}
            />

            {/* Pin overlays on original image (when no revision) */}
            {!hasRevision && pinnedComments.map(c => {
              const idx = pinIndex(c)
              const isActive = activePin === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setActivePin(isActive ? null : c.id)}
                  style={{
                    position: 'absolute',
                    left: `${c.pin_x}%`, top: `${c.pin_y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 26, height: 26, borderRadius: '50%',
                    background: isActive ? 'white' : '#111',
                    border: `2px solid ${isActive ? 'var(--accent)' : 'white'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: isActive ? 'var(--accent)' : 'white',
                    cursor: 'pointer', zIndex: 10,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                  }}
                >
                  {idx}
                </button>
              )
            })}
          </div>

          {/* Original thumbnail reference (shown when revision exists) */}
          {hasRevision && originalThumb && (
            <div style={{
              position: 'absolute', top: 16, right: 16,
              border: '2px solid rgba(255,255,255,0.2)', borderRadius: 8,
              overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px', background: 'rgba(0,0,0,0.7)', textAlign: 'center' }}>
                Original
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={originalThumb}
                alt="Original"
                loading="lazy"
                decoding="async"
                width={120}
                height={120}
                style={{ width: 120, height: 120, objectFit: 'cover', display: 'block' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <div style={{
        width: 320, background: 'var(--surface)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* AI Edit section */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
            ✦ Apply AI Edits
          </div>

          {hasComments ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
                {comments.length} comment{comments.length !== 1 ? 's' : ''} will be compiled into an edit prompt for GPT Image 1.
                {hasRevision && <span style={{ color: 'var(--accent)', display: 'block', marginTop: 4 }}>A revision already exists. Generating again will replace it.</span>}
              </div>

              {/* Quality selector */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {QUALITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setQuality(opt.value)}
                    style={{
                      flex: 1, padding: '6px 4px', borderRadius: 7, fontSize: 11,
                      fontWeight: quality === opt.value ? 700 : 400,
                      cursor: 'pointer', textAlign: 'center',
                      border: `1px solid ${quality === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                      background: quality === opt.value ? 'var(--accent-muted)' : 'transparent',
                      color: quality === opt.value ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {opt.label}
                    <div style={{ fontSize: 10, opacity: 0.8 }}>{opt.price}</div>
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="btn-primary"
                style={{ width: '100%', fontSize: 13, position: 'relative' }}
              >
                {generating ? (
                  <span>Generating… <span style={{ fontSize: 11, opacity: 0.7 }}>(~20s)</span></span>
                ) : (
                  `✦ Generate revision`
                )}
              </button>

              {genError && (
                <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8, lineHeight: 1.5 }}>{genError}</p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              No comments yet on this image. Review it internally and add feedback, or publish it as-is.
            </p>
          )}
        </div>

        {/* Publish to client */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={handlePublish}
            disabled={publishing || published}
            style={{
              width: '100%', fontSize: 13, padding: '9px 0', borderRadius: 8,
              cursor: published ? 'default' : 'pointer',
              border: `1px solid ${published ? 'rgba(34,197,94,0.4)' : 'var(--accent)'}`,
              background: published ? 'rgba(34,197,94,0.12)' : 'transparent',
              color: published ? 'var(--success)' : 'var(--accent)', fontWeight: 600,
            }}
          >
            {published ? '✓ Live to client' : publishing ? 'Publishing…' : asset.client_visible ? '↗ Publish update to client' : '↗ Publish to client'}
          </button>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>
            {published ? 'Visible on the client review link.' : 'Internal only until you publish.'}
          </p>
        </div>

        {/* Comments list */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Reviewer Feedback · {comments.length}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 16 }}>No feedback yet</p>
          )}
          {comments.map(c => {
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinIndex(c) : null
            const isHighlighted = activePin === c.id
            return (
              <div
                key={c.id}
                onClick={() => isPinned ? setActivePin(isHighlighted ? null : c.id) : undefined}
                style={{
                  padding: '10px 12px', borderRadius: 8, cursor: isPinned ? 'pointer' : 'default',
                  border: `1px solid ${isHighlighted ? 'var(--accent)' : 'var(--border)'}`,
                  background: isHighlighted ? 'var(--accent-muted)' : 'var(--surface-raised)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  {isPinned && (
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: isHighlighted ? 'var(--accent)' : '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'white', flexShrink: 0 }}>
                      {pIdx}
                    </span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{c.author_name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
              </div>
            )
          })}

          {/* Show compiled prompt if revision exists */}
          {hasRevision && asset.revision_prompt && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>View prompt used ›</summary>
              <pre style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', marginTop: 6, padding: '8px', background: 'var(--surface-raised)', borderRadius: 6, lineHeight: 1.5 }}>
                {asset.revision_prompt}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreativeAssetsManager({
  projectId,
  brandId,
  initialFolderUrl,
  initialAssets,
  imageComments,
}: {
  projectId: string
  brandId: string
  initialFolderUrl: string | null
  initialAssets: CreativeAsset[]
  imageComments: ProjectComment[]
}) {
  const router = useRouter()
  const [folderUrl, setFolderUrl] = useState(initialFolderUrl ?? '')
  const [assets, setAssets] = useState<CreativeAsset[]>(initialAssets)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [lightboxAsset, setLightboxAsset] = useState<CreativeAsset | null>(null)
  const [bulkPublishing, setBulkPublishing] = useState(false)

  async function handleSync() {
    if (!folderUrl.trim()) return
    setSyncing(true)
    setSyncMsg('')
    try {
      const count = await syncDriveImages(projectId, brandId, folderUrl.trim())
      setSyncMsg(`✓ Synced ${count} image${count !== 1 ? 's' : ''} from Drive`)
      router.refresh()
    } catch (err: unknown) {
      setSyncMsg(`Error: ${err instanceof Error ? err.message : 'Sync failed'}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handleToggle(asset: CreativeAsset) {
    setTogglingId(asset.id)
    try {
      await toggleAssetVisibility(asset.id, !asset.is_hidden, projectId, brandId)
      setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, is_hidden: !a.is_hidden } : a))
      // Update lightbox if this asset is open
      if (lightboxAsset?.id === asset.id) {
        setLightboxAsset(prev => prev ? { ...prev, is_hidden: !prev.is_hidden } : null)
      }
    } finally {
      setTogglingId(null)
    }
  }

  function handleRevisionApplied(assetId: string, revisionUrl: string) {
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, revision_url: revisionUrl } : a))
    setLightboxAsset(prev => prev?.id === assetId ? { ...prev, revision_url: revisionUrl } : prev)
  }

  const assetComments = (assetId: string) => imageComments.filter(c => c.asset_id === assetId)

  const visible = assets.filter(a => !a.is_hidden)
  const hidden = assets.filter(a => a.is_hidden)

  // Client-publish state (client_visible) — distinct from is_hidden.
  const liveCount = assets.filter(a => !a.is_hidden && a.client_visible).length
  const internalCount = assets.filter(a => !a.is_hidden && !a.client_visible).length
  const approvedCount = assets.filter(a => !a.is_hidden && a.status === 'approved').length

  async function handlePublishAllInternal() {
    if (internalCount === 0) return
    if (!confirm(
      `Publish all ${internalCount} internal-only image${internalCount !== 1 ? 's' : ''} to the client?\n\nThey'll appear on the client review link (current revision, or original where there's no revision).`
    )) return
    setBulkPublishing(true)
    setSyncMsg('')
    try {
      const n = await publishAssets(projectId, brandId)
      setAssets(prev => prev.map(a =>
        (a.is_hidden || a.client_visible) ? a : { ...a, client_visible: true, published_url: a.published_url ?? a.revision_url ?? null }
      ))
      setSyncMsg(`Published ${n} image${n !== 1 ? 's' : ''} to the client.`)
    } catch (err) {
      setSyncMsg(err instanceof Error ? `Error: ${err.message}` : 'Error: bulk publish failed')
    } finally {
      setBulkPublishing(false)
    }
  }

  return (
    <div>
      {/* Lightbox */}
      {lightboxAsset && (
        <InternalLightbox
          asset={lightboxAsset}
          comments={assetComments(lightboxAsset.id)}
          projectId={projectId}
          brandId={brandId}
          onClose={() => setLightboxAsset(null)}
          onRevisionApplied={handleRevisionApplied}
        />
      )}

      {/* Drive folder URL sync */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
          Google Drive Folder
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="url"
            value={folderUrl}
            onChange={e => setFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            style={{ flex: 1, fontSize: 13 }}
          />
          <button
            onClick={handleSync}
            disabled={syncing || !folderUrl.trim()}
            className="btn-secondary"
            style={{ fontSize: 13, flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {syncing ? 'Syncing…' : assets.length > 0 ? '↻ Re-sync' : '↓ Sync images'}
          </button>
        </div>
        {syncMsg && (
          <p style={{ fontSize: 12, color: syncMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', marginTop: 6 }}>
            {syncMsg}
          </p>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Share the folder as &quot;Anyone with the link&quot; in Google Drive first
        </p>
      </div>

      {assets.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No images synced yet. Paste a Drive folder URL above and click Sync.
        </p>
      )}

      {assets.length > 0 && (
        <>
          {/* Client-publish summary + bulk publish */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
            padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          }}>
            <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>● {liveCount} live to client</span>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span style={{ color: 'var(--text-muted)' }}>○ {internalCount} internal only</span>
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={handlePublishAllInternal}
              disabled={bulkPublishing || internalCount === 0}
              title={internalCount === 0 ? 'All synced images are already live to the client' : `Publish all ${internalCount} internal-only images to the client`}
              style={{
                fontSize: 12, padding: '7px 12px', borderRadius: 7, fontWeight: 600,
                cursor: internalCount === 0 ? 'not-allowed' : 'pointer',
                border: `1px solid ${internalCount === 0 ? 'var(--border)' : 'var(--accent)'}`,
                background: internalCount === 0 ? 'transparent' : 'var(--accent-muted)',
                color: internalCount === 0 ? 'var(--text-muted)' : 'var(--accent)',
                opacity: internalCount === 0 ? 0.5 : 1,
              }}
            >
              {bulkPublishing ? 'Publishing…' : `↗ Publish all internal${internalCount > 0 ? ` (${internalCount})` : ''}`}
            </button>
            {liveCount > 0 ? (
              <a
                href={`/api/projects/${projectId}/download?set=live`}
                download
                title={`Download all ${liveCount} client-facing image${liveCount !== 1 ? 's' : ''} as a zip`}
                style={{
                  fontSize: 12, padding: '7px 12px', borderRadius: 7, fontWeight: 600, textDecoration: 'none',
                  border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)',
                }}
              >
                ⬇ Download client-facing ({liveCount})
              </a>
            ) : (
              <span title="No client-facing images yet" style={{
                fontSize: 12, padding: '7px 12px', borderRadius: 7, fontWeight: 600,
                border: '1px solid var(--border)', color: 'var(--text-muted)', opacity: 0.5,
              }}>
                ⬇ Download client-facing (0)
              </span>
            )}
            {approvedCount > 0 ? (
              <a
                href={`/api/projects/${projectId}/download?set=approved`}
                download
                title={`Download the ${approvedCount} client-approved image${approvedCount !== 1 ? 's' : ''} as a zip`}
                style={{
                  fontSize: 12, padding: '7px 12px', borderRadius: 7, fontWeight: 600, textDecoration: 'none',
                  border: '1px solid var(--success)', background: 'rgba(34,197,94,0.12)', color: 'var(--success)',
                }}
              >
                ⬇ Download approved ({approvedCount})
              </a>
            ) : (
              <span
                title="No client-approved images yet"
                style={{
                  fontSize: 12, padding: '7px 12px', borderRadius: 7, fontWeight: 600,
                  border: '1px solid var(--border)', color: 'var(--text-muted)', opacity: 0.5,
                }}
              >
                ⬇ Download approved (0)
              </span>
            )}
          </div>

          {/* Synced (not hidden) assets — green dot = live to client, hollow = internal only */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Synced ({visible.length}) — {liveCount} live · {internalCount} internal
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {visible.map((asset, i) => (
                <AssetThumb
                  key={asset.id}
                  asset={asset}
                  index={i}
                  toggling={togglingId === asset.id}
                  commentCount={assetComments(asset.id).length}
                  onToggle={() => handleToggle(asset)}
                  onClick={() => setLightboxAsset(asset)}
                />
              ))}
            </div>
          </div>

          {/* Hidden assets */}
          {hidden.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Hidden from client ({hidden.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {hidden.map((asset, i) => (
                  <AssetThumb
                    key={asset.id}
                    asset={asset}
                    index={i}
                    toggling={togglingId === asset.id}
                    commentCount={assetComments(asset.id).length}
                    onToggle={() => handleToggle(asset)}
                    onClick={() => setLightboxAsset(asset)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AssetThumb({
  asset,
  index,
  toggling,
  commentCount,
  onToggle,
  onClick,
}: {
  asset: CreativeAsset
  index: number
  toggling: boolean
  commentCount: number
  onToggle: () => void
  onClick: () => void
}) {
  const displayUrl = asset.revision_url
    ?? asset.thumbnail_url
    ?? `https://drive.google.com/thumbnail?id=${asset.drive_file_id}&sz=w400`

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block', width: '100%' }}
      >
        {/* next/image: revision_url is a full-size (1-3 MB) Supabase PNG —
            let Vercel's optimizer serve a grid-sized WebP instead. */}
        <Image
          src={displayUrl}
          alt={asset.name ?? `Image ${index + 1}`}
          width={400}
          height={400}
          loading="lazy"
          style={{
            width: '100%', height: 'auto', aspectRatio: '1', objectFit: 'cover',
            borderRadius: 8, display: 'block',
            border: `1px solid ${asset.revision_url ? 'var(--accent)' : 'var(--border)'}`,
            opacity: asset.is_hidden ? 0.35 : 1,
            filter: asset.is_hidden ? 'grayscale(0.5)' : 'none',
            transition: 'opacity 0.2s',
          }}
        />
      </button>

      {/* AI revised indicator */}
      {asset.revision_url && (
        <div style={{
          position: 'absolute', top: 4, left: 4,
          background: 'var(--accent)', color: 'white',
          fontSize: 9, fontWeight: 700, padding: '2px 5px',
          borderRadius: 4, letterSpacing: '0.03em',
        }}>
          ✦ AI
        </div>
      )}

      {/* Client-publish status: green = live to client, hollow = internal only */}
      {!asset.is_hidden && (
        <div title={asset.client_visible ? 'Live to client' : 'Internal only'} style={{
          position: 'absolute', bottom: 6, left: 6,
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 10,
          fontSize: 9, fontWeight: 700,
          color: asset.client_visible ? 'var(--success)' : 'rgba(255,255,255,0.85)',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: asset.client_visible ? 'var(--success)' : 'transparent',
            border: `1.5px solid ${asset.client_visible ? 'var(--success)' : 'rgba(255,255,255,0.8)'}`,
          }} />
          {asset.client_visible ? 'Live' : 'Internal'}
        </div>
      )}

      {/* Comment count badge */}
      {commentCount > 0 && (
        <div style={{
          position: 'absolute', top: 4, right: asset.revision_url ? 4 : 28,
          background: 'rgba(0,0,0,0.75)', color: 'white',
          width: 18, height: 18, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700,
        }}>
          {commentCount}
        </div>
      )}

      {/* Hide/show toggle */}
      <button
        onClick={onToggle}
        disabled={toggling}
        title={asset.is_hidden ? 'Show to client' : 'Hide from client'}
        style={{
          position: 'absolute', bottom: 4, right: 4,
          width: 22, height: 22, borderRadius: '50%',
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: toggling ? 'wait' : 'pointer', fontSize: 11,
        }}
      >
        {toggling ? '…' : asset.is_hidden ? '👁' : '🙈'}
      </button>

      {asset.name && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '2px 4px 26px',
          background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.5))',
          fontSize: 9, color: 'rgba(255,255,255,0.7)',
          borderRadius: '0 0 8px 8px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {asset.name}
        </div>
      )}
    </div>
  )
}
