'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreativePlayer } from '@/components/CreativeMedia'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { VIDEO_STATUS_META, evergreenMediaAsset, type EvergreenVideoStatus } from '@/lib/evergreen'
import { addEvergreenClientComment, approveEvergreenAd, setEvergreenClientVideoStatus } from '@/lib/evergreen-review-actions'
import styles from './evergreen.module.css'

// The client's side of an evergreen ad: each motion video with Approve /
// Needs changes / Reject and a comment thread, plus "Approve all". Modelled on
// the creative review link (ImageReviewPanel) — same layout and the same rule
// that a comment on a video marks it as needing changes. Videos take plain
// comments only: a pin on a video would point at whatever frame was showing.

export type ReviewVideo = { id: string; name: string; video_url: string; poster_url: string | null; status: EvergreenVideoStatus; version: number }
export type ReviewComment = { id: string; video_id: string | null; author_name: string; content: string; created_at: string }

export default function EvergreenReviewPanel({ token, videos, comments, approved }: {
  token: string
  videos: ReviewVideo[]
  comments: ReviewComment[]
  approved: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const [statuses, setStatuses] = useState<Record<string, EvergreenVideoStatus>>(
    () => Object.fromEntries(videos.map(v => [v.id, v.status])),
  )
  const [approving, setApproving] = useState(false)
  // The name is asked once and reused on every comment.
  const [authorName, setAuthorName] = useState('')

  async function approveAll() {
    const ok = await confirm({
      title: 'Approve all videos',
      message: 'This confirms you have watched every video and are happy for them to go live.',
      confirmLabel: 'Approve all',
    })
    if (!ok) return
    setApproving(true)
    const r = await approveEvergreenAd(token)
    setApproving(false)
    if (!r.ok) { toast.error(r.error); return }
    setStatuses(Object.fromEntries(videos.map(v => [v.id, 'approved' as const])))
    toast.success('Approved — thank you!')
    router.refresh()
  }

  if (videos.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>The videos are being prepared — check back soon.</p>
      </div>
    )
  }

  const approvedCount = Object.values(statuses).filter(s => s === 'approved').length
  const changesCount = Object.values(statuses).filter(s => s === 'needs_revision' || s === 'rejected').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: 1, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{videos.length}</strong> video{videos.length === 1 ? '' : 's'}
          </span>
          {approvedCount > 0 && <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ {approvedCount} approved</span>}
          {changesCount > 0 && <span style={{ fontSize: 13, color: 'var(--danger)' }}>↩ {changesCount} need changes</span>}
        </div>
        {approved ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>✓ All videos approved</span>
        ) : (
          <button type="button" onClick={approveAll} disabled={approving} className="btn-primary" style={{ fontSize: 13 }}>
            {approving ? 'Approving…' : '✓ Approve all videos'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {videos.map((v, i) => (
          <VideoReview
            key={v.id}
            token={token}
            video={v}
            index={i}
            status={statuses[v.id] ?? 'pending'}
            onStatus={s => setStatuses(prev => ({ ...prev, [v.id]: s }))}
            initialComments={comments.filter(c => c.video_id === v.id)}
            authorName={authorName}
            setAuthorName={setAuthorName}
          />
        ))}
      </div>

      <GeneralFeedback token={token} initialComments={comments.filter(c => !c.video_id)} authorName={authorName} setAuthorName={setAuthorName} />
    </div>
  )
}

function VideoReview({ token, video, index, status, onStatus, initialComments, authorName, setAuthorName }: {
  token: string
  video: ReviewVideo
  index: number
  status: EvergreenVideoStatus
  onStatus: (s: EvergreenVideoStatus) => void
  initialComments: ReviewComment[]
  authorName: string
  setAuthorName: (s: string) => void
}) {
  const toast = useToast()
  const [comments, setComments] = useState(initialComments)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [saving, setSaving] = useState(false)
  const meta = VIDEO_STATUS_META[status]
  const label = video.name || `Video ${index + 1}`

  async function setStatus(next: EvergreenVideoStatus) {
    if (next === status) return
    setSaving(true)
    const r = await setEvergreenClientVideoStatus(token, video.id, next)
    setSaving(false)
    if (!r.ok) { toast.error(r.error); return }
    onStatus(next)
  }

  async function post(e: React.FormEvent) {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setPosting(true)
    const optimistic: ReviewComment = { id: `temp-${Date.now()}`, video_id: video.id, author_name: authorName.trim() || 'Anonymous', content, created_at: new Date().toISOString() }
    setComments(prev => [...prev, optimistic])
    const r = await addEvergreenClientComment(token, video.id, authorName, content)
    setPosting(false)
    if (!r.ok) {
      setComments(prev => prev.filter(c => c.id !== optimistic.id))
      toast.error(r.error)
      return
    }
    setText('')
    // Same rule as the server: a comment means this video needs changes.
    if (status !== 'rejected') onStatus('needs_revision')
  }

  const btn = (active: boolean, tone: string, activeBg: string): React.CSSProperties => ({
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: saving ? 'wait' : 'pointer', transition: 'all 0.15s',
    border: `1px solid ${active ? tone : 'var(--border)'}`,
    background: active ? activeBg : 'var(--surface-raised)',
    color: active ? tone : 'var(--text-secondary)',
  })

  return (
    <div className={styles.videoRow} style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px',
      border: `1px solid ${status !== 'pending' ? meta.border : 'var(--border)'}`,
      borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', transition: 'border-color 0.2s',
    }}>
      <div style={{ background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CreativePlayer
          asset={evergreenMediaAsset(video)}
          src={video.video_url}
          poster={video.poster_url}
          audience="client"
          alt={label}
          style={{ width: '100%', maxHeight: 600, display: 'block', objectFit: 'contain' }}
        />
      </div>

      <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', maxHeight: 600 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {comments.length} comment{comments.length !== 1 ? 's' : ''}
            {status !== 'pending' && <span style={{ marginLeft: 8, fontWeight: 600, color: meta.color }}>· {meta.label}</span>}
          </div>
        </div>

        <form onSubmit={post} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input type="text" placeholder="Your name (optional)" value={authorName} onChange={e => setAuthorName(e.target.value)} style={{ marginBottom: 6, fontSize: 12 }} />
          <textarea placeholder="What should we change? Mention the timestamp if it helps (e.g. 0:12)." value={text} onChange={e => setText(e.target.value)} rows={2} style={{ resize: 'none', fontSize: 12, marginBottom: 6 }} />
          <button type="submit" disabled={posting || !text.trim()} className="btn-primary" style={{ width: '100%', fontSize: 12, padding: '7px 12px' }}>
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </form>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>No comments yet</p>}
          {comments.map(c => <CommentBubble key={c.id} c={c} />)}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button type="button" disabled={saving} onClick={() => setStatus(status === 'approved' ? 'pending' : 'approved')}
            style={btn(status === 'approved', 'var(--success)', 'rgba(34,197,94,0.12)')}>
            ✓ {status === 'approved' ? 'Approved' : 'Approve'}
          </button>
          <button type="button" disabled={saving} onClick={() => setStatus(status === 'needs_revision' ? 'pending' : 'needs_revision')}
            style={btn(status === 'needs_revision', 'var(--danger)', 'rgba(239,68,68,0.1)')}>
            ↩ {status === 'needs_revision' ? 'Changes requested' : 'Needs changes'}
          </button>
          <button type="button" disabled={saving} title="Scrap this video entirely — different from 'needs changes'"
            onClick={() => setStatus(status === 'rejected' ? 'pending' : 'rejected')}
            style={btn(status === 'rejected', '#fca5a5', 'rgba(127,29,29,0.18)')}>
            ✕ {status === 'rejected' ? 'Rejected' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

function GeneralFeedback({ token, initialComments, authorName, setAuthorName }: {
  token: string
  initialComments: ReviewComment[]
  authorName: string
  setAuthorName: (s: string) => void
}) {
  const toast = useToast()
  const [comments, setComments] = useState(initialComments)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  async function post(e: React.FormEvent) {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setPosting(true)
    const r = await addEvergreenClientComment(token, null, authorName, content)
    setPosting(false)
    if (!r.ok) { toast.error(r.error); return }
    setComments(prev => [...prev, { id: `temp-${Date.now()}`, video_id: null, author_name: authorName.trim() || 'Anonymous', content, created_at: new Date().toISOString() }])
    setText('')
  }

  return (
    <section style={{ marginTop: 'var(--space-8)', maxWidth: 880 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        General feedback
      </h2>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        {comments.map(c => <CommentBubble key={c.id} c={c} />)}
        <form onSubmit={post} style={{ display: 'grid', gap: 6 }}>
          <input type="text" placeholder="Your name (optional)" value={authorName} onChange={e => setAuthorName(e.target.value)} style={{ fontSize: 13 }} />
          <textarea placeholder="Anything about the ad as a whole…" value={text} onChange={e => setText(e.target.value)} rows={3} style={{ resize: 'vertical', fontSize: 13 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn-primary" disabled={posting || !text.trim()} style={{ fontSize: 13 }}>
              {posting ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}

function CommentBubble({ c }: { c: ReviewComment }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>💬</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{c.author_name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
    </div>
  )
}
