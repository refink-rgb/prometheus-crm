'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import { CALIBRATION_TRACKS } from '@/lib/bfcm/production'
import type { CalibrationFeedback, CalibrationItem, CalibrationTrackState } from '@/lib/bfcm/production-server'
import { clientAddSampleFeedback, clientSetSampleStatus, clientSubmitCalibrationTrack } from '@/lib/bfcm/calibration-actions'

type Status = 'pending' | 'approved' | 'needs_changes'
const NAME_KEY = 'bfcm-reviewer-name'
const readName = () => { try { return window.localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
const saveName = (name: string) => { try { window.localStorage.setItem(NAME_KEY, name) } catch { /* private mode */ } }

/**
 * The client's side of calibration, modelled on the Moments review link: a tab per
 * track with its own approval. Each sample gets a verdict and notes (pinned on
 * images), then one submit closes that track.
 */
export default function BfcmCalibrationReview({ token, tracks, items, feedback }: { token: string; tracks: CalibrationTrackState[]; items: CalibrationItem[]; feedback: CalibrationFeedback[] }) {
  const visible = CALIBRATION_TRACKS.filter(t => tracks.some(state => state.track === t.id))
  const [tab, setTab] = useState<string>(visible[0]?.id ?? 'statics')
  const [name, setName] = useState('')
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
  useEffect(() => { setName(readName()) }, [])
  const open = tracks.some(t => t.status === 'sent')

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
    {open && <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>These are real ads from your Black Friday set, made first so you can shape everything that follows. Your feedback here sets the direction for the rest of the set, so this is the moment to tell us what’s working and what isn’t. Mark each creative, leave notes (click “Pin a note” to point at a spot on an image), then submit your feedback at the bottom. Once you submit, we build the rest of your set from it.</p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', maxWidth: 320, textTransform: 'none', letterSpacing: 'normal', margin: 0 }}>
        Your name
        <input value={name} onChange={e => { setName(e.target.value); saveName(e.target.value) }} placeholder="So we know who left each note" style={{ padding: '8px 10px', fontWeight: 400 }} />
      </label>
    </div>}
    {/* Same tab idiom as ClientReviewTabs on the Moments review link. */}
    <div>
      <div role="tablist" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 24, overflowX: 'auto', overflowY: 'hidden' }}>
        {visible.map(t => {
          const count = items.filter(i => i.track === t.id).length
          return <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 12px', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, whiteSpace: 'nowrap',
            color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
            marginBottom: -1, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {t.label}
            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: 'var(--surface-raised)', color: 'var(--text-secondary)' }}>{count}</span>
          </button>
        })}
      </div>
      {/* All tracks stay mounted, so switching tabs never loses a half-written note. */}
      {visible.map(t => <div key={t.id} hidden={tab !== t.id}>
        <TrackReview token={token} name={name} label={t.label} track={t.id} state={tracks.find(state => state.track === t.id)!} items={items.filter(i => i.track === t.id)} feedback={feedback} />
      </div>)}
    </div>
  </div>
}

function TrackReview({ token, name, label, track, state, items, feedback }: { token: string; name: string; label: string; track: string; state: CalibrationTrackState; items: CalibrationItem[]; feedback: CalibrationFeedback[] }) {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const [statuses, setStatuses] = useState<Record<string, string>>(() => Object.fromEntries(items.map(i => [i.id, i.client_status])))
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const locked = state.status === 'submitted'
  const lower = label.toLowerCase()
  const approved = Object.values(statuses).filter(st => st === 'approved').length
  const changes = Object.values(statuses).filter(st => st === 'needs_changes').length

  async function submit() {
    const ok = await confirm({ title: `Submit your ${lower} feedback`, message: `This sends your notes on the ${lower} to the team, who use them to build the rest of your set. You won’t be able to change them here afterwards.`, confirmLabel: 'Submit feedback' })
    if (!ok) return
    setSubmitting(true)
    const result = await clientSubmitCalibrationTrack(token, track, name, note)
    if (result.ok) { toast.success('Thank you! Your feedback is with the team.'); router.refresh() } else toast.error(result.error)
    setSubmitting(false)
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
    {locked && <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 10, background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)', color: 'var(--success)', fontWeight: 600 }}>
      {label} feedback submitted{state.submitted_by_name ? ` by ${state.submitted_by_name}` : ''}. Thank you, the team is using it to build the rest of your set.
    </div>}
    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}><strong style={{ color: 'var(--text-primary)' }}>{items.length}</strong> creatives · <span style={{ color: 'var(--success)' }}>{approved} look good</span> · <span style={{ color: 'var(--danger)' }}>{changes} need changes</span></div>
    {items.map((item, i) => <Sample key={item.id} index={i} item={item} token={token} name={name} locked={locked}
      status={statuses[item.id] ?? 'pending'} onStatus={st => setStatuses(prev => ({ ...prev, [item.id]: st }))}
      initial={feedback.filter(f => f.item_id === item.id)} />)}
    {!locked && items.length > 0 && <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong>Anything else about the overall direction of the {lower}?</strong>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={5000} placeholder="Optional" style={{ padding: '8px 10px', resize: 'vertical' }} />
      <div><button className="btn-primary" disabled={submitting} onClick={() => void submit()}>{submitting ? 'Submitting…' : `Submit ${lower} feedback`}</button></div>
    </div>}
  </div>
}

function Sample({ index, item, token, name, locked, status, onStatus, initial }: { index: number; item: CalibrationItem; token: string; name: string; locked: boolean; status: string; onStatus: (s: Status) => void; initial: CalibrationFeedback[] }) {
  const toast = useToast()
  const [notes, setNotes] = useState(initial)
  const [text, setText] = useState('')
  const [pinMode, setPinMode] = useState(false)
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const pinned = notes.filter(n => n.pin_x != null && n.pin_y != null)
  const isImage = item.media_type === 'image'

  async function setStatus(next: Status) {
    if (locked || busy) return
    const target = status === next ? 'pending' : next
    setBusy(true)
    const result = await clientSetSampleStatus(token, item.id, target)
    if (result.ok) onStatus(target); else toast.error(result.error)
    setBusy(false)
  }
  async function post(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    const result = await clientAddSampleFeedback(token, item.id, name, text, pin)
    if (result.ok) {
      setNotes(prev => [...prev, { id: result.id, item_id: item.id, author_name: name.trim() || 'Client', body: text.trim(), pin_x: pin?.x ?? null, pin_y: pin?.y ?? null, created_at: new Date().toISOString() }])
      setText(''); setPin(null)
    } else toast.error(result.error)
    setBusy(false)
  }
  const button = (active: boolean, color: string): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 8, font: 'inherit', fontSize: 13, fontWeight: 600, cursor: locked ? 'default' : 'pointer', border: `1px solid ${active ? color : 'var(--border)'}`, background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--surface-raised)', color: active ? color : 'var(--text-secondary)' })

  return <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-5)' }}>
    <div style={{ position: 'relative', alignSelf: 'start', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-raised)', cursor: pinMode ? 'crosshair' : 'default' }}
      onClick={e => {
        if (!pinMode || !isImage) return
        const rect = e.currentTarget.getBoundingClientRect()
        setPin({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }); setPinMode(false)
      }}>
      {isImage ? <img src={item.url} alt={`Creative ${index + 1}`} style={{ width: '100%', display: 'block' }} /> : <video src={item.url} controls playsInline preload="metadata" style={{ width: '100%', display: 'block' }} />}
      {isImage && [...pinned.map((n, i) => ({ key: n.id, x: n.pin_x!, y: n.pin_y!, label: String(i + 1) })), ...(pin ? [{ key: 'new', x: pin.x, y: pin.y, label: '+' }] : [])].map(p =>
        <span key={p.key} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, width: 22, height: 22, margin: '-11px 0 0 -11px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', pointerEvents: 'none' }}>{p.label}</span>)}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <strong>Creative {index + 1}</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={button(status === 'approved', 'var(--success)')} disabled={locked || busy} aria-pressed={status === 'approved'} onClick={() => void setStatus('approved')}>✓ Looks good</button>
        <button style={button(status === 'needs_changes', 'var(--danger)')} disabled={locked || busy} aria-pressed={status === 'needs_changes'} onClick={() => void setStatus('needs_changes')}>↩ Needs changes</button>
      </div>
      {notes.map(n => <div key={n.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong>{n.pin_x != null ? `${pinned.indexOf(n) + 1}. ` : ''}{n.author_name}</strong>
        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{n.body}</div>
      </div>)}
      {!locked && <form onSubmit={e => void post(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={5000} placeholder={pin ? 'Note for the pinned spot…' : 'What should change, or what do you like?'} aria-label={`Note on creative ${index + 1}`}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text-primary)', font: 'inherit', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isImage && <button type="button" className="btn-secondary btn-sm" onClick={() => { setPinMode(m => !m); setPin(null) }}>{pinMode ? 'Click the image…' : pin ? 'Move pin' : '📍 Pin a note'}</button>}
          <button className="btn-primary btn-sm" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Add note'}</button>
        </div>
      </form>}
    </div>
  </div>
}
