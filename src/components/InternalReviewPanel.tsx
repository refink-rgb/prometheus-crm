'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  addInternalAssetComment,
  updateAssetStatusInternal,
  applyAiEdits,
  applyDirectPrompt,
  approveAndPublishRevision,
  publishAssets,
  uploadInternalReference,
  archiveAssetToDeleteFolder,
  purgeStaleAssets,
} from '@/lib/actions'
import type { CreativeAsset, ProjectComment } from '@/lib/types'

const QUALITY_OPTIONS: Array<{ value: 'low' | 'medium' | 'high'; label: string; price: string }> = [
  { value: 'low',    label: 'Low',    price: '$0.011' },
  { value: 'medium', label: 'Medium', price: '$0.042' },
  { value: 'high',   label: 'High',   price: '$0.167' },
]

const STATUS_COLORS: Record<CreativeAsset['status'], { bg: string; color: string; border: string; label: string }> = {
  pending:        { bg: 'transparent',         color: 'var(--text-muted)', border: 'var(--border)',          label: 'Pending' },
  approved:       { bg: 'rgba(34,197,94,0.12)',color: 'var(--success)',    border: 'rgba(34,197,94,0.3)',    label: '✓ Approved' },
  needs_revision: { bg: 'rgba(239,68,68,0.1)', color: 'var(--danger)',     border: 'rgba(239,68,68,0.3)',    label: '↩ Revision' },
  rejected:       { bg: 'rgba(127,29,29,0.18)',color: '#fca5a5',           border: 'rgba(127,29,29,0.5)',    label: '✕ Rejected' },
}

type AssetLocal = CreativeAsset & { internal_status: CreativeAsset['internal_status'] }

export default function InternalReviewPanel({
  projectId,
  brandId,
  assets: initialAssets,
  initialComments,
  projectName,
  currentUserName,
}: {
  projectId: string
  brandId: string
  assets: CreativeAsset[]
  initialComments: ProjectComment[]
  projectName: string
  currentUserName: string
}) {
  const [assets, setAssets] = useState<AssetLocal[]>(
    initialAssets.map(a => ({ ...a, internal_status: a.internal_status ?? 'pending' }))
  )
  const [comments, setComments] = useState<ProjectComment[]>(initialComments)
  const [activeIdx, setActiveIdx] = useState(0)

  // Clamp active index when assets array changes.
  useEffect(() => {
    if (activeIdx >= assets.length) setActiveIdx(Math.max(0, assets.length - 1))
  }, [assets.length, activeIdx])

  const activeAsset: AssetLocal | undefined = assets[activeIdx]

  // Arrow-key nav between assets (disabled while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if (assets.length < 2) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setActiveIdx(i => (i - 1 + assets.length) % assets.length)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setActiveIdx(i => (i + 1) % assets.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assets.length])

  const handleStatusChange = useCallback((assetId: string, status: CreativeAsset['status']) => {
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, internal_status: status } : a))
  }, [])

  const handleRevisionApplied = useCallback((assetId: string, revisionUrl: string) => {
    setAssets(prev => prev.map(a => a.id === assetId ? { ...a, revision_url: revisionUrl } : a))
  }, [])

  const handlePublished = useCallback((assetId: string, publishedUrl: string | null) => {
    setAssets(prev => prev.map(a => {
      if (a.id !== assetId) return a
      return { ...a, client_visible: true, published_url: publishedUrl ?? a.revision_url ?? a.published_url }
    }))
  }, [])

  const handleCommentAdded = useCallback((c: ProjectComment) => {
    setComments(prev => [...prev, c])
  }, [])

  // Remove an asset from the local list (used after archiving/purging it to the
  // Delete folder — the row is now hidden, no point keeping it in view).
  const handleAssetRemoved = useCallback((assetId: string) => {
    setAssets(prev => prev.filter(a => a.id !== assetId))
  }, [])

  // "Stale" = either soft-hidden OR client-rejected. The internal panel may be
  // showing rejected assets the team hasn't yet purged; this drives the button.
  const staleCount = useMemo(
    () => assets.filter(a => a.is_hidden || a.internal_status === 'rejected').length,
    [assets]
  )

  const [purging, setPurging] = useState(false)

  // Client visibility = client_visible (what the client review link filters on).
  const liveCount = useMemo(() => assets.filter(a => a.client_visible).length, [assets])
  const internalCount = assets.length - liveCount
  const approvedCount = useMemo(() => assets.filter(a => a.status === 'approved' && !a.is_hidden).length, [assets])

  const [bulkPublishing, setBulkPublishing] = useState(false)
  async function handlePublishAllInternal() {
    if (internalCount === 0) return
    if (!confirm(
      `Publish all ${internalCount} internal-only image${internalCount !== 1 ? 's' : ''} to the client?\n\nThey'll appear on the client review link (current revision, or the original where there's no revision).`
    )) return
    setBulkPublishing(true)
    try {
      const n = await publishAssets(projectId, brandId)
      setAssets(prev => prev.map(a => a.client_visible ? a : { ...a, client_visible: true, published_url: a.published_url ?? a.revision_url ?? null }))
      alert(`Published ${n} image${n !== 1 ? 's' : ''} to the client.`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk publish failed')
    } finally {
      setBulkPublishing(false)
    }
  }

  async function handlePurgeStale() {
    if (staleCount === 0) return
    if (!confirm(
      `Move ${staleCount} stale asset${staleCount !== 1 ? 's' : ''} into the project's "Delete" folder on Drive?\n\nThis keeps the comments + revisions in the CRM and is reversible (the file is moved, not deleted).`
    )) return
    setPurging(true)
    try {
      const purged = await purgeStaleAssets(projectId, brandId)
      // Drop purged assets from the local view — they're now hidden.
      setAssets(prev => prev.filter(a => !(a.is_hidden || a.internal_status === 'rejected')))
      alert(`Moved ${purged} asset${purged !== 1 ? 's' : ''} to Delete folder.`)
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Purge failed')
    } finally {
      setPurging(false)
    }
  }

  if (assets.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No creatives synced yet for this project.</p>
        <Link
          href={`/brands/${brandId}/projects/${projectId}`}
          style={{ display: 'inline-block', marginTop: 12, fontSize: 13, color: 'var(--accent)' }}
        >
          ← Back to project
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18,
        padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <Link
          href={`/brands/${brandId}/projects/${projectId}`}
          style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          ← Back to project
        </Link>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {projectName}
          <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
            · Internal review
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>{activeIdx + 1}</strong> / {assets.length}
        </div>
        <button
          onClick={handlePurgeStale}
          disabled={purging || staleCount === 0}
          title={staleCount === 0 ? 'No stale assets' : `Move ${staleCount} stale asset${staleCount !== 1 ? 's' : ''} to the project's Delete folder on Drive`}
          style={{
            fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 600,
            cursor: staleCount === 0 ? 'not-allowed' : 'pointer',
            border: '1px solid rgba(127,29,29,0.5)',
            background: staleCount === 0 ? 'transparent' : 'rgba(127,29,29,0.12)',
            color: staleCount === 0 ? 'var(--text-muted)' : '#fca5a5',
            opacity: staleCount === 0 ? 0.5 : 1,
          }}
        >
          {purging ? 'Purging…' : `Purge to Delete folder${staleCount > 0 ? ` (${staleCount})` : ''}`}
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>● {liveCount} live</span>
          <span>·</span>
          <span>○ {internalCount} internal</span>
        </div>
        <button
          onClick={handlePublishAllInternal}
          disabled={bulkPublishing || internalCount === 0}
          title={internalCount === 0 ? 'All images are already live to the client' : `Publish all ${internalCount} internal-only images to the client`}
          style={{
            fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 600,
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
              fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 600, textDecoration: 'none',
              border: '1px solid var(--accent)', background: 'var(--accent-muted)', color: 'var(--accent)',
            }}
          >
            ⬇ Download client-facing ({liveCount})
          </a>
        ) : (
          <span title="No client-facing images yet" style={{
            fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 600,
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
              fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 600, textDecoration: 'none',
              border: '1px solid var(--success)', background: 'rgba(34,197,94,0.12)', color: 'var(--success)',
            }}
          >
            ⬇ Download approved ({approvedCount})
          </a>
        ) : (
          <span
            title="No client-approved images yet"
            style={{
              fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 600,
              border: '1px solid var(--border)', color: 'var(--text-muted)', opacity: 0.5,
            }}
          >
            ⬇ Download approved (0)
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          <kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd>
          <span>navigate</span>
        </div>
      </div>

      {/* Asset strip */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 18,
        padding: '4px 2px',
      }}>
        {assets.map((a, i) => {
          const isActive = i === activeIdx
          const thumb = a.revision_url ?? a.thumbnail_url ?? `https://drive.google.com/thumbnail?id=${a.drive_file_id}&sz=w200`
          return (
            <button
              key={a.id}
              onClick={() => setActiveIdx(i)}
              title={a.name ?? `Creative ${i + 1}`}
              style={{
                position: 'relative', flexShrink: 0,
                width: 64, height: 64, borderRadius: 8, overflow: 'hidden',
                padding: 0, cursor: 'pointer',
                border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                background: 'var(--surface-raised)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {/* Client-visibility dot: filled green = live to client, hollow = internal only */}
              <div title={a.client_visible ? 'Live to client' : 'Internal only'} style={{
                position: 'absolute', top: 3, right: 3, width: 10, height: 10, borderRadius: '50%',
                background: a.client_visible ? 'var(--success)' : 'rgba(0,0,0,0.35)',
                border: `1.5px solid ${a.client_visible ? 'var(--success)' : 'rgba(255,255,255,0.7)'}`,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
              }} />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: 4, background: STATUS_COLORS[a.internal_status].color,
                opacity: a.internal_status === 'pending' ? 0 : 1,
              }} />
            </button>
          )
        })}
      </div>

      {activeAsset && (
        <AssetView
          key={activeAsset.id}
          asset={activeAsset}
          projectId={projectId}
          brandId={brandId}
          comments={comments.filter(c => c.asset_id === activeAsset.id)}
          currentUserName={currentUserName}
          onStatusChange={handleStatusChange}
          onRevisionApplied={handleRevisionApplied}
          onPublished={handlePublished}
          onCommentAdded={handleCommentAdded}
          onAssetRemoved={handleAssetRemoved}
        />
      )}
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 10,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'var(--surface-raised)',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
}

// ─── Single asset view ───────────────────────────────────────────────────────

function AssetView({
  asset,
  projectId,
  brandId,
  comments,
  currentUserName,
  onStatusChange,
  onRevisionApplied,
  onPublished,
  onCommentAdded,
  onAssetRemoved,
}: {
  asset: AssetLocal
  projectId: string
  brandId: string
  comments: ProjectComment[]
  currentUserName: string
  onStatusChange: (assetId: string, status: CreativeAsset['status']) => void
  onRevisionApplied: (assetId: string, revisionUrl: string) => void
  onPublished: (assetId: string, publishedUrl: string | null) => void
  onCommentAdded: (c: ProjectComment) => void
  onAssetRemoved: (assetId: string) => void
}) {
  const [archiving, setArchiving] = useState(false)
  // Pin / comment composer state
  const [pinMode, setPinMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)
  const [activePin, setActivePin] = useState<string | null>(null)
  const [authorName, setAuthorName] = useState(currentUserName)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)

  // Generate-revision-from-comments state
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  // Direct prompt panel state
  const [directPrompt, setDirectPrompt] = useState('')
  const [directRefs, setDirectRefs] = useState<File[]>([])
  const [directQuality, setDirectQuality] = useState<'low' | 'medium' | 'high'>('low')
  const [directRunning, setDirectRunning] = useState(false)
  const [directError, setDirectError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Publish state
  const [publishing, setPublishing] = useState(false)
  const [publishedLocal, setPublishedLocal] = useState(
    !!asset.client_visible && (!asset.revision_url || asset.published_url === asset.revision_url)
  )

  // Status local mirror (parent already tracks it but we want instant toggles)
  const [statusLocal, setStatusLocal] = useState<CreativeAsset['status']>(asset.internal_status)
  useEffect(() => { setStatusLocal(asset.internal_status) }, [asset.internal_status])

  // Reset transient UI when the asset changes (key change in parent handles this,
  // but keep belt-and-suspenders on published flag).
  useEffect(() => {
    setPublishedLocal(!!asset.client_visible && (!asset.revision_url || asset.published_url === asset.revision_url))
  }, [asset.id, asset.client_visible, asset.published_url, asset.revision_url])

  const pinnedComments = useMemo(() => comments.filter(c => c.pin_x != null), [comments])
  const pinIndex = (c: ProjectComment) => pinnedComments.findIndex(p => p.id === c.id) + 1

  // Display: latest INTERNAL state (revision_url) — internal review is about
  // what's about-to-be-published OR being-iterated, NOT what client currently sees.
  const displaySrc = asset.revision_url
    ?? asset.thumbnail_url
    ?? `https://drive.google.com/thumbnail?id=${asset.drive_file_id}&sz=w2048`

  const isLive = !!asset.client_visible && !!asset.published_url

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPendingPin({ x, y })
    setPinMode(false)
  }, [pinMode])

  async function handlePostComment(e: React.FormEvent) {
    e.preventDefault()
    if (!commentText.trim()) return
    setPosting(true)
    const name = authorName.trim() || currentUserName || 'Team'
    const optimistic: ProjectComment = {
      id: `temp-${Date.now()}`,
      project_id: projectId,
      author_name: name,
      content: commentText.trim(),
      created_at: new Date().toISOString(),
      track: 'image',
      asset_id: asset.id,
      pin_x: pendingPin?.x ?? null,
      pin_y: pendingPin?.y ?? null,
      section_tag: null,
      audience: 'internal',
      attachment_urls: null,
    }
    onCommentAdded(optimistic)
    try {
      await addInternalAssetComment({
        projectId,
        brandId,
        assetId: asset.id,
        content: commentText.trim(),
        displayName: name,
        pin_x: pendingPin?.x,
        pin_y: pendingPin?.y,
      })
      setCommentText('')
      setPendingPin(null)
    } catch (err) {
      // Optimistic rollback handled by parent re-render on next refresh; for now
      // just surface a console error so the user sees no posting.
      console.error(err)
    } finally {
      setPosting(false)
    }
  }

  async function handleStatus(newStatus: CreativeAsset['status']) {
    const target = newStatus === statusLocal ? 'pending' : newStatus
    const prev = statusLocal
    setStatusLocal(target)
    onStatusChange(asset.id, target)
    try {
      await updateAssetStatusInternal(asset.id, projectId, brandId, target)
    } catch (err) {
      console.error(err)
      setStatusLocal(prev)
      onStatusChange(asset.id, prev)
    }
  }

  async function handleGenerateFromComments() {
    const price = QUALITY_OPTIONS.find(q => q.value === quality)!.price
    if (!confirm(`Generate AI revision from comments at ${quality} quality (${price}/image)?`)) return
    setGenerating(true)
    setGenError('')
    try {
      const { revisionUrl } = await applyAiEdits(asset.id, projectId, brandId, quality)
      onRevisionApplied(asset.id, revisionUrl)
      setPublishedLocal(false)
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleDirectPrompt(e: React.FormEvent) {
    e.preventDefault()
    if (!directPrompt.trim()) return
    const price = QUALITY_OPTIONS.find(q => q.value === directQuality)!.price
    if (!confirm(`Send this prompt to GPT Image 1 at ${directQuality} quality (${price}/image)?`)) return
    setDirectRunning(true)
    setDirectError('')
    try {
      // 1) Upload any reference images first.
      const referenceImagePaths: string[] = []
      for (const file of directRefs) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('asset_id', asset.id)
        const { storagePath } = await uploadInternalReference(fd)
        referenceImagePaths.push(storagePath)
      }
      // 2) Apply the prompt.
      const { revisionUrl } = await applyDirectPrompt({
        assetId: asset.id,
        projectId,
        brandId,
        prompt: directPrompt.trim(),
        quality: directQuality,
        referenceImagePaths: referenceImagePaths.length ? referenceImagePaths : undefined,
      })
      onRevisionApplied(asset.id, revisionUrl)
      setPublishedLocal(false)
      setDirectPrompt('')
      setDirectRefs([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: unknown) {
      setDirectError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setDirectRunning(false)
    }
  }

  async function handlePublish() {
    if (!confirm('Publish this version to the client? They will see this on the review link.')) return
    setPublishing(true)
    try {
      await approveAndPublishRevision(asset.id, projectId, brandId)
      setPublishedLocal(true)
      onPublished(asset.id, asset.revision_url ?? null)
    } catch (err) {
      console.error(err)
    } finally {
      setPublishing(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Move this creative\'s file into the project\'s "Delete" folder on Drive?\n\nThe CRM row stays so comments + revisions are preserved. Reversible by restoring the file.')) return
    setArchiving(true)
    try {
      await archiveAssetToDeleteFolder(asset.id, projectId, brandId)
      onAssetRemoved(asset.id)
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Archive failed')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
      {/* ── LEFT: image with pin overlay ── */}
      <div style={{
        background: '#080808', borderRadius: 12, border: '1px solid var(--border)',
        overflow: 'hidden', position: 'relative',
      }}>
        <div
          style={{ position: 'relative', cursor: pinMode ? 'crosshair' : 'default', minHeight: 400 }}
          onClick={handleImageClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displaySrc}
            alt={asset.name ?? 'Creative'}
            decoding="async"
            style={{ width: '100%', display: 'block', userSelect: 'none', maxHeight: 'calc(100vh - 260px)', objectFit: 'contain', background: '#080808' }}
            draggable={false}
          />

          {/* Pending pin */}
          {pendingPin && (
            <div style={{
              position: 'absolute',
              left: `${pendingPin.x}%`, top: `${pendingPin.y}%`,
              transform: 'translate(-50%, -50%)',
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--accent)', border: '2px solid white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: 'white',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)', zIndex: 10, pointerEvents: 'none',
            }}>
              {pinnedComments.length + 1}
            </div>
          )}

          {/* Existing pins */}
          {pinnedComments.map(c => {
            const idx = pinIndex(c)
            const isActive = activePin === c.id
            return (
              <button
                key={c.id}
                onClick={e => { e.stopPropagation(); setActivePin(isActive ? null : c.id) }}
                style={{
                  position: 'absolute',
                  left: `${c.pin_x}%`, top: `${c.pin_y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 26, height: 26, borderRadius: '50%',
                  background: isActive ? 'white' : '#111',
                  border: `2px solid ${isActive ? 'var(--accent)' : 'white'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: isActive ? 'var(--accent)' : 'white',
                  cursor: 'pointer', zIndex: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
                }}
              >
                {idx}
              </button>
            )
          })}
        </div>

        {/* Pin toggle button overlay */}
        <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.4)', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { setPinMode(m => !m); setPendingPin(null) }}
            style={{
              width: '100%', padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.15s',
              border: `1px solid ${pinMode ? 'var(--accent)' : 'var(--border)'}`,
              background: pinMode ? 'var(--accent-muted)' : 'var(--surface-raised)',
              color: pinMode ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            📍 {pinMode ? 'Click on the image to drop a pin…' : 'Add pin comment'}
          </button>
        </div>
      </div>

      {/* ── RIGHT: side panel ── */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {asset.name ?? 'Creative asset'}
            </div>
            {asset.revision_url && (
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-muted)', padding: '2px 6px', borderRadius: 4 }}>
                ✦ AI Revised
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
              border: `1px solid ${STATUS_COLORS[statusLocal].border}`,
              background: STATUS_COLORS[statusLocal].bg,
              color: STATUS_COLORS[statusLocal].color,
            }}>
              {STATUS_COLORS[statusLocal].label}
            </span>
            {isLive ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--success)', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', padding: '2px 7px', borderRadius: 4 }}>
                ● Live on client
              </span>
            ) : (
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '2px 7px', borderRadius: 4 }}>
                ○ Internal only
              </span>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <button
            onClick={() => handleStatus('approved')}
            style={statusBtnStyle(statusLocal === 'approved', 'rgba(34,197,94,0.12)', 'rgba(34,197,94,0.4)', 'var(--success)')}
          >
            ✓ {statusLocal === 'approved' ? 'Approved' : 'Approve'}
          </button>
          <button
            onClick={() => handleStatus('needs_revision')}
            style={statusBtnStyle(statusLocal === 'needs_revision', 'rgba(239,68,68,0.1)', 'rgba(239,68,68,0.4)', 'var(--danger)')}
          >
            ↩ {statusLocal === 'needs_revision' ? 'Revision' : 'Revise'}
          </button>
          <button
            onClick={() => handleStatus('rejected')}
            style={statusBtnStyle(statusLocal === 'rejected', 'rgba(127,29,29,0.18)', 'rgba(127,29,29,0.6)', '#fca5a5')}
          >
            ✕ {statusLocal === 'rejected' ? 'Rejected' : 'Reject'}
          </button>
        </div>

        {/* "Move to Delete folder" — a more deliberate action than reject. Use
            when the team wants the file out of the way regardless of client
            decision. Reject already auto-archives, but this works on any
            status (e.g. low-quality drafts the client never needed to see). */}
        <div style={{ padding: '6px 14px 10px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={handleArchive}
            disabled={archiving}
            style={{
              width: '100%', fontSize: 11, padding: '6px 10px', borderRadius: 6, fontWeight: 500,
              cursor: archiving ? 'default' : 'pointer',
              border: '1px solid rgba(127,29,29,0.5)',
              background: 'transparent',
              color: '#fca5a5',
            }}
          >
            {archiving ? 'Moving…' : '🗑 Move to Delete folder'}
          </button>
        </div>

        {/* Comment composer */}
        <form onSubmit={handlePostComment} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
            Internal comment
          </div>
          {pendingPin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0,
              }}>{pinnedComments.length + 1}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Pinned</span>
              <button type="button" onClick={() => setPendingPin(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </div>
          )}
          <input
            type="text"
            placeholder="Your name"
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            style={{ marginBottom: 6, fontSize: 12, width: '100%' }}
          />
          <textarea
            placeholder={pendingPin ? 'Comment on this spot…' : 'Leave internal feedback on this image…'}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            rows={2}
            style={{ resize: 'none', fontSize: 12, marginBottom: 6, width: '100%' }}
          />
          <button
            type="submit"
            disabled={posting || !commentText.trim()}
            className="btn-primary"
            style={{ width: '100%', fontSize: 12, padding: '7px 12px' }}
          >
            {posting ? 'Posting…' : 'Post internal comment'}
          </button>
        </form>

        {/* Comment list */}
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: '4px 0' }}>No comments yet</p>
          )}
          {comments.map(c => {
            const isPinned = c.pin_x != null
            const pIdx = isPinned ? pinIndex(c) : null
            const isActive = activePin === c.id
            const aud = c.audience ?? 'client'
            return (
              <div
                key={c.id}
                onClick={() => isPinned ? setActivePin(isActive ? null : c.id) : undefined}
                style={{
                  padding: '8px 10px', borderRadius: 7,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--accent-muted)' : 'var(--surface-raised)',
                  cursor: isPinned ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {isPinned ? (
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: isActive ? 'var(--accent)' : '#333',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, fontWeight: 700, color: 'white', flexShrink: 0,
                    }}>{pIdx}</span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>💬</span>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.author_name}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                    background: aud === 'internal' ? 'var(--surface)' : 'var(--accent-muted)',
                    color: aud === 'internal' ? 'var(--text-muted)' : 'var(--accent)',
                    border: `1px solid ${aud === 'internal' ? 'var(--border)' : 'transparent'}`,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {aud}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
              </div>
            )
          })}
        </div>

        {/* Ask Claude / direct prompt */}
        <form onSubmit={handleDirectPrompt} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
            ✦ Ask Claude to edit
          </div>
          <textarea
            placeholder="Describe the edit in plain English… e.g. 'swap headline to: Buy 1 Get 1 Free' or 'use this reference image for the bottle'"
            value={directPrompt}
            onChange={e => setDirectPrompt(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', fontSize: 12, width: '100%', marginBottom: 8 }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => setDirectRefs(Array.from(e.target.files ?? []))}
            style={{ fontSize: 11, marginBottom: 8, width: '100%' }}
          />
          {directRefs.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              {directRefs.length} reference image{directRefs.length !== 1 ? 's' : ''} attached
              {directRefs.length > 1 && (
                <div style={{ fontSize: 10, fontStyle: 'italic', marginTop: 2 }}>
                  v1 limitation: only the source image is sent to the model — describe how to use the references in your prompt.
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {QUALITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDirectQuality(opt.value)}
                style={{
                  flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 10,
                  fontWeight: directQuality === opt.value ? 700 : 400,
                  cursor: 'pointer', textAlign: 'center',
                  border: `1px solid ${directQuality === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: directQuality === opt.value ? 'var(--accent-muted)' : 'transparent',
                  color: directQuality === opt.value ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {opt.label} <span style={{ opacity: 0.7 }}>{opt.price}</span>
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={directRunning || !directPrompt.trim()}
            className="btn-primary"
            style={{ width: '100%', fontSize: 12, padding: '7px 12px' }}
          >
            {directRunning ? 'Editing…' : '✦ Apply edit'}
          </button>
          {directError && (
            <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6, lineHeight: 1.5 }}>{directError}</p>
          )}
        </form>

        {/* Generate from comments */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
            Generate revision from comments
          </div>
          {comments.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
              Add reviewer comments first.
            </p>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                {comments.length} comment{comments.length !== 1 ? 's' : ''} will be compiled into an edit prompt.
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {QUALITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setQuality(opt.value)}
                    style={{
                      flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 10,
                      fontWeight: quality === opt.value ? 700 : 400,
                      cursor: 'pointer', textAlign: 'center',
                      border: `1px solid ${quality === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                      background: quality === opt.value ? 'var(--accent-muted)' : 'transparent',
                      color: quality === opt.value ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {opt.label} <span style={{ opacity: 0.7 }}>{opt.price}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerateFromComments}
                disabled={generating}
                className="btn-secondary"
                style={{ width: '100%', fontSize: 12 }}
              >
                {generating ? 'Generating…' : '✦ Generate from comments'}
              </button>
              {genError && (
                <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6, lineHeight: 1.5 }}>{genError}</p>
              )}
            </>
          )}
        </div>

        {/* Publish to client */}
        <div style={{ padding: '12px 14px' }}>
          <button
            onClick={handlePublish}
            disabled={publishing || publishedLocal}
            style={{
              width: '100%', fontSize: 12, padding: '9px 0', borderRadius: 8,
              cursor: publishedLocal ? 'default' : 'pointer',
              border: `1px solid ${publishedLocal ? 'rgba(34,197,94,0.4)' : 'var(--accent)'}`,
              background: publishedLocal ? 'rgba(34,197,94,0.12)' : 'transparent',
              color: publishedLocal ? 'var(--success)' : 'var(--accent)',
              fontWeight: 600,
            }}
          >
            {publishedLocal ? '✓ Live to client' : publishing ? 'Publishing…' : asset.client_visible ? '↗ Publish update to client' : '↗ Publish to client'}
          </button>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>
            {publishedLocal ? 'Visible on the client review link.' : 'Internal only until you publish.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function statusBtnStyle(active: boolean, activeBg: string, activeBorder: string, activeColor: string): React.CSSProperties {
  return {
    flex: 1,
    padding: '7px 8px', borderRadius: 7, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
    border: `1px solid ${active ? activeBorder : 'var(--border)'}`,
    background: active ? activeBg : 'var(--surface-raised)',
    color: active ? activeColor : 'var(--text-secondary)',
  }
}
