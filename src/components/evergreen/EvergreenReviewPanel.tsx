'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreativePlayer } from '@/components/CreativeMedia'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import {
  MEDIA_LABELS, REVIEW_STATUS_META, countLabel, evergreenMediaAsset, isSentBack, stampDate,
  type EvergreenMediaType, type EvergreenReviewStatus, type Pin,
} from '@/lib/evergreen'
import { addEvergreenClientComment, approveEvergreenAd, setEvergreenClientStatus } from '@/lib/evergreen-review-actions'
import { PinDot, pinNumbers } from './EvergreenPins'
import styles from './evergreen.module.css'

// The client's side of an evergreen ad. Statics and Motion each get a tab (like
// BFCM calibration and the Moments review link). Each item has Approve / Needs
// changes / Reject and a comment thread; on a static a note can be pinned to a
// spot. Videos take plain comments: a pin would point at whatever frame showed.
// A comment marks the item as needing changes, same as the creative review link.

export type ReviewCreative = { id: string; name: string; media_type: EvergreenMediaType; url: string; poster_url: string | null; status: EvergreenReviewStatus; version: number }
export type ReviewComment = { id: string; creative_id: string | null; author_name: string; content: string; pin_x: number | null; pin_y: number | null; created_at: string }

const NAME_KEY = 'evergreen-reviewer-name'
const readName = () => { try { return window.localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
const saveName = (name: string) => { try { window.localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ } }

export default function EvergreenReviewPanel({ token, creatives, comments, approved }: {
  token: string
  creatives: ReviewCreative[]
  comments: ReviewComment[]
  approved: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const [statuses, setStatuses] = useState<Record<string, EvergreenReviewStatus>>(() => Object.fromEntries(creatives.map(c => [c.id, c.status])))
  const [approving, setApproving] = useState(false)
  // The name is asked once, kept for next time, and reused on every comment.
  const [name, setName] = useState('')
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
  useEffect(() => { setName(readName()) }, [])
  const changeName = (v: string) => { setName(v); saveName(v) }

  const tabs = (['image', 'video'] as const).filter(t => creatives.some(c => c.media_type === t))
  const [tab, setTab] = useState<EvergreenMediaType>(tabs[0] ?? 'image')

  async function approveAll() {
    const ok = await confirm({
      title: 'Approve everything',
      message: 'This confirms you have looked at every static and video and are happy for them to go live.',
      confirmLabel: 'Approve everything',
    })
    if (!ok) return
    setApproving(true)
    const r = await approveEvergreenAd(token, name)
    setApproving(false)
    if (!r.ok) { toast.error(r.error); return }
    setStatuses(Object.fromEntries(creatives.map(c => [c.id, 'approved' as const])))
    toast.success('Approved. Thank you!')
    router.refresh()
  }

  if (creatives.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>The creatives are being prepared. Check back soon.</p>
      </div>
    )
  }

  const values = Object.values(statuses)
  const approvedCount = values.filter(s => s === 'approved').length
  const changesCount = values.filter(isSentBack).length
  const summary = tabs.map(t => countLabel(creatives.filter(c => c.media_type === t).length, t)).join(' · ')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: 1, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{summary}</span>
          {approvedCount > 0 && <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ {approvedCount} approved</span>}
          {changesCount > 0 && <span style={{ fontSize: 13, color: 'var(--danger)' }}>↩ {changesCount} need changes</span>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', margin: 0, textTransform: 'none', letterSpacing: 'normal', fontWeight: 500 }}>
          Your name
          <input value={name} onChange={e => changeName(e.target.value)} placeholder="So we know who left each note" style={{ width: 220, padding: '6px 10px', fontSize: 13 }} />
        </label>
        {approved ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>✓ Everything approved</span>
        ) : (
          <button type="button" onClick={approveAll} disabled={approving} className="btn-primary" style={{ fontSize: 13 }}>
            {approving ? 'Approving…' : '✓ Approve everything'}
          </button>
        )}
      </div>

      {tabs.length > 1 && (
        <div role="tablist" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
          {tabs.map(t => {
            const count = creatives.filter(c => c.media_type === t).length
            return (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 12px', fontSize: 13, fontWeight: tab === t ? 700 : 500,
                color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1, display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                {MEDIA_LABELS[t].section}
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Both tabs stay mounted, so switching never loses a half-written note. */}
      {tabs.map(t => (
        <div key={t} style={{ display: tab === t ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
          {creatives.filter(c => c.media_type === t).map((c, i) => (
            <ItemReview
              key={c.id}
              token={token}
              creative={c}
              index={i}
              status={statuses[c.id] ?? 'pending'}
              onStatus={s => setStatuses(prev => ({ ...prev, [c.id]: s }))}
              initialComments={comments.filter(cm => cm.creative_id === c.id)}
              name={name}
            />
          ))}
        </div>
      ))}

      <GeneralFeedback token={token} initialComments={comments.filter(c => !c.creative_id)} name={name} />
    </div>
  )
}

function ItemReview({ token, creative, index, status, onStatus, initialComments, name }: {
  token: string
  creative: ReviewCreative
  index: number
  status: EvergreenReviewStatus
  onStatus: (s: EvergreenReviewStatus) => void
  initialComments: ReviewComment[]
  name: string
}) {
  const toast = useToast()
  const [comments, setComments] = useState(initialComments)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pinMode, setPinMode] = useState(false)
  const [pin, setPin] = useState<Pin | null>(null)
  const meta = REVIEW_STATUS_META[status]
  const isImage = creative.media_type === 'image'
  const label = creative.name || `${isImage ? 'Static' : 'Video'} ${index + 1}`
  const pins = pinNumbers(comments)

  async function setStatus(next: EvergreenReviewStatus) {
    if (next === status) return
    setSaving(true)
    const r = await setEvergreenClientStatus(token, creative.id, next)
    setSaving(false)
    if (!r.ok) { toast.error(r.error); return }
    onStatus(next)
  }

  async function post(e: React.FormEvent) {
    e.preventDefault()
    const content = text.trim()
    if (!content || posting) return
    setPosting(true)
    const r = await addEvergreenClientComment(token, creative.id, name, content, pin)
    setPosting(false)
    if (!r.ok) { toast.error(r.error); return }
    setComments(prev => [...prev, { id: r.id, creative_id: creative.id, author_name: name.trim() || 'Anonymous', content, pin_x: pin?.x ?? null, pin_y: pin?.y ?? null, created_at: new Date().toISOString() }])
    setText('')
    setPin(null)
    // Same rule as the server: a comment means this one needs changes.
    if (status !== 'rejected') onStatus('needs_revision')
  }

  function placePin(e: React.MouseEvent<HTMLDivElement>) {
    if (!pinMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clamp = (n: number) => Math.min(100, Math.max(0, n))
    setPin({ x: clamp(((e.clientX - rect.left) / rect.width) * 100), y: clamp(((e.clientY - rect.top) / rect.height) * 100) })
    setPinMode(false)
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
      <div style={{ background: isImage ? 'var(--surface-raised)' : '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        {isImage ? (
          <div onClick={placePin} style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', cursor: pinMode ? 'crosshair' : 'default' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload, shown at its own size */}
            <img src={creative.url} alt={label} style={{ display: 'block', maxWidth: '100%', maxHeight: 600 }} />
            {comments.filter(c => pins.has(c.id)).map(c => <PinDot key={c.id} x={c.pin_x!} y={c.pin_y!} label={String(pins.get(c.id))} />)}
            {pin && <PinDot x={pin.x} y={pin.y} label="+" />}
          </div>
        ) : (
          <CreativePlayer asset={evergreenMediaAsset({ video_url: creative.url, poster_url: creative.poster_url })} src={creative.url} poster={creative.poster_url}
            audience="client" alt={label} style={{ width: '100%', maxHeight: 600, display: 'block', objectFit: 'contain' }} />
        )}
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
          <textarea
            placeholder={pin ? 'Note for the pinned spot…' : isImage ? 'What should we change? Pin it to a spot if it helps.' : 'What should we change? Mention the timestamp if it helps (e.g. 0:12).'}
            aria-label={`Comment on ${label}`} value={text} onChange={e => setText(e.target.value)} rows={2} style={{ resize: 'none', fontSize: 12, marginBottom: 6 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            {isImage && (
              <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '7px 10px', whiteSpace: 'nowrap' }} onClick={() => { setPinMode(m => !m); setPin(null) }}>
                {pinMode ? 'Click the image…' : pin ? 'Move pin' : '📍 Pin a note'}
              </button>
            )}
            <button type="submit" disabled={posting || !text.trim()} className="btn-primary" style={{ flex: 1, fontSize: 12, padding: '7px 12px' }}>
              {posting ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>No comments yet</p>}
          {comments.map(c => <CommentBubble key={c.id} c={c} pin={pins.get(c.id)} />)}
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
          <button type="button" disabled={saving} title="Scrap this one entirely, different from 'needs changes'"
            onClick={() => setStatus(status === 'rejected' ? 'pending' : 'rejected')}
            style={btn(status === 'rejected', '#fca5a5', 'rgba(127,29,29,0.18)')}>
            ✕ {status === 'rejected' ? 'Rejected' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

function GeneralFeedback({ token, initialComments, name }: { token: string; initialComments: ReviewComment[]; name: string }) {
  const toast = useToast()
  const [comments, setComments] = useState(initialComments)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  async function post(e: React.FormEvent) {
    e.preventDefault()
    const content = text.trim()
    if (!content || posting) return
    setPosting(true)
    const r = await addEvergreenClientComment(token, null, name, content)
    setPosting(false)
    if (!r.ok) { toast.error(r.error); return }
    setComments(prev => [...prev, { id: r.id, creative_id: null, author_name: name.trim() || 'Anonymous', content, pin_x: null, pin_y: null, created_at: new Date().toISOString() }])
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
          <textarea placeholder="Anything about the ad as a whole…" aria-label="General feedback" value={text} onChange={e => setText(e.target.value)} rows={3} style={{ resize: 'vertical', fontSize: 13 }} />
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

function CommentBubble({ c, pin }: { c: ReviewComment; pin?: number }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-raised)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        {pin
          ? <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--accent)', borderRadius: 10, padding: '0 6px', lineHeight: '16px' }}>{pin}</span>
          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>💬</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{c.author_name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{stampDate(c.created_at)}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.content}</p>
    </div>
  )
}
