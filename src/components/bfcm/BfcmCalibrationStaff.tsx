'use client'
import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CALIBRATION_TRACKS } from '@/lib/bfcm/production'
import type { Calibration, CalibrationFeedback, CalibrationItem, CalibrationTrackState } from '@/lib/bfcm/production-server'
import { attachCalibrationItem, copyCalibrationDriveFile, createCalibrationUploadUrl, publishCalibrationTrack, removeCalibrationItem, reopenCalibrationTrack, setCalibrationItemsVisible, startCalibration, syncCalibrationFolder } from '@/lib/bfcm/calibration-actions'
import s from './BfcmProduction.module.css'

const BUCKET = 'project-images'
const BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' }
const ACCEPTED = new Set(Object.values(BY_EXT))
const typeOf = (file: File) => ACCEPTED.has(file.type) ? file.type : BY_EXT[(file.name.split('.').pop() || '').toLowerCase()] ?? null
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const CLIENT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Not reviewed', color: 'var(--text-secondary)' },
  approved: { label: 'Looks good', color: 'var(--success)' },
  needs_changes: { label: 'Needs changes', color: 'var(--danger)' },
}
// Origin only exists in the browser; the server renders the path, the client fills in the rest without a mismatch.
const useOrigin = () => useSyncExternalStore(() => () => {}, () => window.location.origin, () => '')
const clientStatus = (status: string) => CLIENT_STATUS[status] ?? { label: status, color: 'var(--text-secondary)' }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The Slack message the team sends with the link. Counts are what the client will actually see.
 * `text` is the plain fallback (link written out); `html` pastes into Slack with "HERE" as a link and the why in italics.
 */
export function clientMessage({ to, link, statics, motion, due }: { to: string; link: string; statics: number; motion: number; due: string }) {
  const set = statics && !motion ? 'static set' : motion && !statics ? 'motion set' : 'set'
  const batch = [statics ? plural(statics, 'static', 'statics') : '', motion ? plural(motion, 'video', 'videos') : ''].filter(Boolean).join(' and ') || 'a few ads'
  const name = to.trim() ? `@${to.trim().replace(/^@/, '')}` : 'team'
  const lines = {
    hey: `Hey ${name}`,
    intro: `Before we make your full Black Friday ${set}, we've made a small first batch so you can shape the direction: ${batch}.`,
    why: `Why this matters: this is the most important review of the campaign. Whatever you tell us here (the look, the copy, how the offer is framed, anything to avoid) gets applied to every ad that follows. Clear feedback now means the full set comes back right the first time, instead of being reworked later when there's far more of it.`,
    steps: ['Open the link and enter your name.', 'For each ad, click "Looks good" or "Needs changes".', "Leave a note on anything you'd change.", 'Add any overall thoughts at the bottom, then click Submit.'],
    close: `Once you submit, we use your notes to build the rest of your set. ${due ? `Please send your feedback by ${longDay(due)} so we stay on schedule.` : 'Please send your feedback as soon as you can so we stay on schedule.'}`,
  }
  const text = [lines.hey, lines.intro, `_${lines.why}_`, `You can review them here: ${link}`, ['How it works:', ...lines.steps.map((t, i) => `${i + 1}. ${t}`)].join('\n'), lines.close, 'Thanks!'].join('\n\n')
  const html = [
    `<p>${esc(lines.hey)}</p>`, `<p>${esc(lines.intro)}</p>`, `<p><i>${esc(lines.why)}</i></p>`,
    `<p>You can review them <a href="${esc(link)}"><b>HERE</b></a>.</p>`,
    `<p>How it works:</p><ol>${lines.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`,
    `<p>${esc(lines.close)}</p>`, '<p>Thanks!</p>',
  ].join('')
  return { text, html }
}

type Props = { slug: string; brandName: string; data: { calibration: Calibration | null; tracks: CalibrationTrackState[]; items: CalibrationItem[]; feedback: CalibrationFeedback[] } | null; revisions: string | null }

/** Staff view of client calibration, inside the samples task: one client link, two tracks. */
export default function BfcmCalibrationStaff({ slug, data, revisions }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [over, setOver] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedMsg, setCopiedMsg] = useState(false)
  const [showMsg, setShowMsg] = useState(false)
  const [due, setDue] = useState('')
  const [to, setTo] = useState('')
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [synced, setSynced] = useState('')
  const [folder, setFolder] = useState(data?.calibration?.drive_folder_url ?? '')
  const origin = useOrigin()

  async function act(label: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label); setErrors([])
    const result = await action()
    if (!result.ok) setErrors([result.error ?? 'Something went wrong.'])
    router.refresh()
    setBusy(null)
  }
  // Same as a Moments project: the team pastes their Drive folder, the CRM copies what's in it.
  // Files are copied one per request so a folder of large videos never times out.
  async function syncDrive(folderUrl: string) {
    setBusy('Reading the Drive folder…'); setErrors([]); setSynced('')
    const plan = await syncCalibrationFolder(slug, folderUrl)
    if (!plan.ok) { setErrors([plan.error]); setBusy(null); router.refresh(); return }
    const failed: string[] = plan.unsupported.map(n => `${n}: not an image or video, skipped.`)
    let copiedCount = 0
    for (const [i, file] of plan.files.entries()) {
      setBusy(`Copying ${i + 1} of ${plan.files.length} from Drive: ${file.name}`)
      const result = await copyCalibrationDriveFile(slug, file.id)
      if (result.ok) copiedCount++; else failed.push(result.error)
    }
    const notes = [
      plan.files.length === 0 ? `Up to date: ${plan.unchanged} sample${plan.unchanged === 1 ? '' : 's'} already copied.` : `Copied ${copiedCount} of ${plan.files.length} from Drive.${plan.unchanged ? ` ${plan.unchanged} already up to date.` : ''}`,
      plan.closed ? `${plan.closed} in a track the client already submitted, left alone.` : '',
      `Files found per folder: ${plan.found}.`,
      plan.ignored.length ? `Not images or videos, so not read: ${plan.ignored.join(', ')}.` : '',
      plan.skippedFolders.length ? `Skipped folders: ${plan.skippedFolders.join(', ')} (only Motion and Statics folders are read).` : '',
    ]
    setSynced(notes.filter(Boolean).join(' '))
    setErrors(failed); setBusy(null)
    router.refresh()
  }
  async function upload(track: string, files: File[]) {
    const failed: string[] = []
    const supabase = createClient()
    for (const [i, file] of files.entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}: ${file.name}`)
      const type = typeOf(file)
      if (!type) { failed.push(`${file.name}: use JPG, PNG, WebP, GIF, MP4, MOV or WebM.`); continue }
      try {
        const signed = await createCalibrationUploadUrl(slug, track, type, file.size)
        if (!signed.ok) { failed.push(`${file.name}: ${signed.error}`); continue }
        // uploadToSignedUrl sends the File's own type and ignores contentType; re-wrap so a
        // blank browser type (common for .mov) can't be refused by the bucket.
        const body = file.type === type ? file : new File([file], file.name, { type })
        const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, body, { contentType: type, cacheControl: '3600' })
        if (error) { failed.push(`${file.name}: ${error.message}`); continue }
        const attached = await attachCalibrationItem(slug, track, signed.path, file.name.replace(/\.[^.]+$/, ''), type)
        if (!attached.ok) failed.push(`${file.name}: ${attached.error}`)
      } catch (e) { failed.push(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed.'}`) }
    }
    setErrors(failed); setBusy(null)
    router.refresh()
  }

  if (data === null) return <div className={s.box}><p className={s.muted} style={{ margin: 0 }}>Calibration is unavailable right now. Everything else on this page still works.</p></div>
  const { calibration, tracks, items, feedback } = data
  const errorList = errors.map(e => <p key={e} role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{e}</p>)
  if (!calibration) return <div className={s.box} id="calibration">
    <div><strong>Client calibration</strong><p className={s.muted} style={{ margin: '4px 0 0' }}>Add statics and motion samples, publish them to one client link, and collect notes on each before making the full set.</p></div>
    {revisions && <p className={s.muted} style={{ margin: 0 }}><strong>Contract revisions:</strong> {revisions}</p>}
    <div><button className="btn-primary btn-sm" disabled={!!busy} onClick={() => void act('start', () => startCalibration(slug))}>Start calibration</button></div>
    {errorList}
  </div>

  const link = `${origin}/review/bfcm/${calibration.share_token}`
  const stateOf = (id: string) => tracks.find(t => t.track === id) ?? { track: id, status: 'draft', sent_at: null, submitted_at: null, submitted_by_name: null, client_note: null }
  const live = CALIBRATION_TRACKS.filter(t => stateOf(t.id).status !== 'draft')
  const working = busy?.startsWith('Copying') || busy?.startsWith('Reading')
  // The message counts only what the client can act on now: shown files in tracks still open for review.
  const openTracks: string[] = CALIBRATION_TRACKS.filter(t => stateOf(t.id).status === 'sent').map(t => t.id)
  // Each open track is in the message unless unticked (e.g. statics already went out, this message is motion only).
  const included = (track: string) => openTracks.includes(track) && include[track] !== false
  const countFor = (track: string) => included(track) ? items.filter(i => i.track === track && i.client_visible).length : 0
  const message = clientMessage({ to, link, statics: countFor('statics'), motion: countFor('motion'), due })
  async function copyMessage() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([message.html], { type: 'text/html' }), 'text/plain': new Blob([message.text], { type: 'text/plain' }) })])
    } catch {
      await navigator.clipboard.writeText(message.text)
    }
    setCopiedMsg(true); setTimeout(() => setCopiedMsg(false), 1500)
  }

  return <div className={s.box} id="calibration">
    <strong>Client calibration</strong>
    {revisions && <p className={s.muted} style={{ margin: 0 }}><strong>Contract revisions:</strong> {revisions}</p>}

    <div>
      <p className={s.panelTitle}>Client link</p>
      <div className={s.inline}>
        <input className={s.linkField} readOnly value={link} aria-label="Client calibration link" onFocus={e => e.target.select()} />
        <button className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      {live.length === 0
        ? <p className={s.notice} data-tone="warn">Nothing is published yet. Anyone opening this link sees “Your samples are being prepared.”</p>
        : <p className={s.notice} data-tone="ok">Live on this link: {live.map(t => t.label).join(' and ')}.</p>}
      <p className={s.muted} style={{ margin: '6px 0 0' }}>Publishing doesn’t notify anyone. Share this link with the client yourself when you’re ready.</p>
      <div className={s.inline} style={{ marginTop: 10 }}>
        <button className="btn-secondary btn-sm" onClick={() => setShowMsg(v => !v)} aria-expanded={showMsg}>{showMsg ? 'Hide client message' : 'Client message (Slack)'}</button>
        {showMsg && <button className="btn-primary btn-sm" onClick={() => { void copyMessage() }}>{copiedMsg ? 'Copied' : 'Copy for Slack'}</button>}
      </div>
      {showMsg && <>
        <div className={s.inline} style={{ marginTop: 8, flexWrap: 'wrap', gap: 12 }}>
          <label className={s.msgLabel}>To <input value={to} onChange={e => setTo(e.target.value)} placeholder="Maddie" style={{ width: 120, padding: '4px 6px', fontSize: 12 }} /></label>
          <label className={s.msgLabel}>Feedback by <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ width: 'auto', padding: '4px 6px', fontSize: 12 }} /></label>
          {openTracks.length > 1 && CALIBRATION_TRACKS.filter(t => openTracks.includes(t.id)).map(t =>
            <label key={t.id} className={s.msgLabel}><input type="checkbox" checked={include[t.id] !== false} onChange={e => setInclude(v => ({ ...v, [t.id]: e.target.checked }))} /> {t.label}</label>)}
        </div>
        {openTracks.length === 0 && <p className={s.notice} data-tone="warn">No track is open for review. Publish one first, or the client has nothing to look at.</p>}
        <p className={s.muted} style={{ margin: '6px 0 0' }}>Copies with “HERE” as a link. Type the @mention again in Slack so it tags them.</p>
        <textarea readOnly value={message.text} rows={18} aria-label="Message to send the client" onFocus={e => e.target.select()} style={{ width: '100%', marginTop: 8, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text-primary)', resize: 'vertical' }} />
      </>}
    </div>

    <div>
      <p className={s.panelTitle}>Drive folder</p>
      <form className={s.inline} onSubmit={e => { e.preventDefault(); if (folder.trim() && !busy) void syncDrive(folder) }}>
        <input className={s.linkField} value={folder} onChange={e => setFolder(e.target.value)} placeholder="Paste the client’s 01 Calibration folder" aria-label="Calibration Drive folder" disabled={!!busy} />
        <button className="btn-primary btn-sm" disabled={!!busy || !folder.trim()}>{calibration.drive_folder_url ? 'Sync again' : 'Sync from Drive'}</button>
      </form>
      <p className={s.muted} style={{ margin: '6px 0 0' }}>{working ? busy : synced || 'Paste the 01 Calibration folder. Reads the files directly in Motion and Static; folders inside them (old versions) are ignored.'}</p>
    </div>

    {CALIBRATION_TRACKS.map(track => {
      const state = stateOf(track.id)
      const trackItems = items.filter(i => i.track === track.id)
      const locked = state.status === 'submitted'
      const shown = trackItems.filter(i => i.client_visible)
      const approved = shown.filter(i => i.client_status === 'approved').length
      const changes = shown.filter(i => i.client_status === 'needs_changes').length
      return <section key={track.id} className={s.track} aria-label={track.label}>
        <div className={s.inline} style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>{track.label}</strong> <span className={s.muted}>{trackItems.length} sample{trackItems.length === 1 ? '' : 's'}{trackItems.length > 0 && ` · ${shown.length} shown to client`}</span>
            <div className={s.chip} data-state={state.status}>
              {state.status === 'draft' ? 'Internal only: the client can’t see these'
                : state.status === 'sent' ? `✓ Live to client since ${day(state.sent_at)}`
                : `✓ ${state.submitted_by_name ?? 'Client'} submitted feedback ${day(state.submitted_at)}`}
            </div>
          </div>
          <div className={s.inline}>
            {trackItems.length > 1 && <>
              <button className={s.linkBtn} disabled={!!busy || shown.length === trackItems.length} onClick={() => void act('show', () => setCalibrationItemsVisible(slug, trackItems.map(i => i.id), true))}>Show all</button>
              <button className={s.linkBtn} disabled={!!busy || shown.length === 0} onClick={() => { if (state.status === 'draft' || window.confirm(`Hide all ${trackItems.length} ${track.label.toLowerCase()} from the client link? Then tick the ones to show.`)) void act('hide', () => setCalibrationItemsVisible(slug, trackItems.map(i => i.id), false)) }}>Hide all</button>
            </>}
            {state.status === 'draft' && <button className="btn-primary btn-sm" disabled={!!busy || !shown.length} title={shown.length ? undefined : 'Tick at least one sample to show'} onClick={() => { if (window.confirm(`Publish ${shown.length} ${track.label.toLowerCase()} sample${shown.length === 1 ? '' : 's'} to the client link?\n\nThis doesn’t notify anyone. The client sees them when you share the link.`)) void act('publish', () => publishCalibrationTrack(slug, track.id)) }}>↗ Publish to client</button>}
            {state.status === 'sent' && <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Take the ${track.label.toLowerCase()} samples off the client link?`)) void act('unpublish', () => reopenCalibrationTrack(slug, track.id, 'draft')) }}>Unpublish</button>}
            {locked && <button className="btn-secondary btn-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Reopen ${track.label.toLowerCase()} so the client can change their feedback?`)) void act('reopen', () => reopenCalibrationTrack(slug, track.id, 'sent')) }}>Reopen for the client</button>}
          </div>
        </div>
        {state.status !== 'draft' && shown.length > 0 && <p className={s.muted} style={{ margin: 0 }}>{approved} look good · {changes} need changes · {shown.length - approved - changes} not reviewed</p>}
        {state.client_note && <div><p className={s.panelTitle}>Client’s overall note</p><p className={s.commentBody} style={{ margin: 0 }}>{state.client_note}</p></div>}
        {trackItems.length > 0 && <div className={s.grid}>{trackItems.map(item => {
          const notes = feedback.filter(f => f.item_id === item.id)
          const pins = notes.filter(f => f.pin_x != null && f.pin_y != null)
          const st = clientStatus(item.client_status)
          return <div key={item.id} className={s.tile} style={item.client_visible ? undefined : { opacity: .55 }}>
            <div className={s.thumb}>
              {item.media_type === 'video' ? <video src={item.url} controls muted playsInline preload="metadata" /> : <img src={item.url} alt={item.name} loading="lazy" />}
              {item.media_type === 'image' && pins.map((p, i) => <span key={p.id} className={s.pin} style={{ left: `${p.pin_x}%`, top: `${p.pin_y}%` }} title={p.body}>{i + 1}</span>)}
            </div>
            <div className={s.tileBody}>
              <label title={item.client_visible ? 'Untick to take this file off the client link' : 'Tick to show this file on the client link'} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 12, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal', cursor: busy ? 'wait' : 'pointer', color: item.client_visible ? 'var(--success)' : 'var(--text-secondary)' }}>
                <input type="checkbox" checked={item.client_visible} disabled={!!busy} onChange={e => void act('visible', () => setCalibrationItemsVisible(slug, [item.id], e.target.checked))} style={{ width: 'auto', margin: 0 }} />
                {item.client_visible ? 'Shown to client' : 'Hidden from client'}
              </label>
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</strong>
              {state.status !== 'draft' && item.client_visible && <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>}
              {notes.map(n => <span key={n.id}><strong>{n.pin_x != null ? `${pins.indexOf(n) + 1}. ` : ''}{n.author_name}:</strong> {n.body}</span>)}
              {!locked && <button className={s.linkBtn} style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => { if (window.confirm(`Remove “${item.name}”?${notes.length ? ' Its client comments go with it.' : ''}`)) void act('remove', () => removeCalibrationItem(slug, item.id)) }}>Remove</button>}
            </div>
          </div>
        })}</div>}
        {!locked && <label className={s.drop} data-over={over === track.id} onDragOver={e => { e.preventDefault(); setOver(track.id) }} onDragLeave={() => setOver(null)} onDrop={e => { e.preventDefault(); setOver(null); if (!busy) void upload(track.id, [...e.dataTransfer.files]) }}>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.mov,.m4v" hidden disabled={!!busy} onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void upload(track.id, files) }} />
          {busy?.startsWith('Uploading') ? busy : `Or drop single ${track.label.toLowerCase()} files here`}
        </label>}
      </section>
    })}
    {errorList}
  </div>
}
