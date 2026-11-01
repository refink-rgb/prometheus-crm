'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import OnboardingTranscriptField from '@/components/OnboardingTranscriptField'
import { saveBrandProfileFields } from '@/lib/brands/actions'

// The onboarding call: a link to the recording and/or the transcript. Read
// first, long text clamped, like intake answers.

export default function OnboardingCall({ brandId, url, transcript, canEdit }: { brandId: string; url: string | null; transcript: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [all, setAll] = useState(false)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const long = (transcript?.length ?? 0) > 600

  function save(form: FormData) {
    setErr('')
    start(async () => {
      const r = await saveBrandProfileFields(brandId, {
        onboarding_call_url: String(form.get('onboarding_call_url') ?? ''),
        onboarding_transcript: String(form.get('onboarding_transcript') ?? ''),
      })
      if (r.ok) { setEditing(false); router.refresh() } else setErr(r.error)
    })
  }

  if (editing) {
    return (
      <form action={save} className="bp-form">
        <div>
          <label htmlFor="bp-call-url">Recording link</label>
          <input id="bp-call-url" name="onboarding_call_url" defaultValue={url ?? ''} placeholder="https://fathom.video/share/…" />
        </div>
        <OnboardingTranscriptField initialValue={transcript} />
        {err && <p role="alert" className="mo-error" style={{ margin: 0 }}>{err}</p>}
        <div className="mo-row">
          <button type="submit" className="btn-primary btn-sm" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
          <button type="button" className="bp-link bp-link-muted" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div>
      {!url && !transcript && <p className="bp-empty">No onboarding call yet.</p>}
      {url && <p style={{ margin: '0 0 8px' }}><a href={url} target="_blank" rel="noopener noreferrer" className="bp-link">Open the recording ↗</a></p>}
      {transcript && (
        <>
          <p className="bp-transcript" style={long && !all ? { maxHeight: 120, overflow: 'hidden' } : undefined}>{transcript}</p>
          {long && <button type="button" className="bp-link" onClick={() => setAll(a => !a)}>{all ? 'Show less' : 'Show all'}</button>}
        </>
      )}
      {canEdit && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="bp-link" onClick={() => setEditing(true)}>{url || transcript ? 'Edit' : 'Add the call'}</button>
        </div>
      )}
    </div>
  )
}
