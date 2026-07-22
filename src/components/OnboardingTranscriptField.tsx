'use client'

import { useRef, useState } from 'react'

interface OnboardingTranscriptFieldProps {
  initialValue: string | null
}

// Textarea for the onboarding meeting transcript, with a "Load from file"
// helper that reads a plain-text export (Fireflies, Otter, Meet captions:
// .txt/.vtt/.srt/.md) client-side and drops it into the textarea. The value
// is submitted as part of the surrounding Account Details form under
// name="onboarding_transcript" — no separate action needed.
export default function OnboardingTranscriptField({ initialValue }: OnboardingTranscriptFieldProps) {
  const [value, setValue] = useState(initialValue ?? '')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setErr(null)
    setLoading(true)
    try {
      const text = await file.text()
      // Append if there's already content, so we don't nuke an in-progress paste.
      setValue(prev => prev.trim() ? `${prev.trim()}\n\n${text}` : text)
    } catch {
      setErr('Could not read that file. Try a plain text export (.txt, .vtt, .srt, .md).')
    } finally {
      setLoading(false)
    }
  }

  const charCount = value.length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <label style={{ marginBottom: 0 }}>Onboarding Meeting Transcript</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {charCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {charCount.toLocaleString('en-US')} chars
            </span>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            style={{
              fontSize: 11, fontWeight: 500,
              color: 'var(--accent)',
              background: 'var(--accent-muted)',
              border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
              borderRadius: 6,
              padding: '3px 10px',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Reading…' : '↑ Load from file'}
          </button>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => setValue('')}
              style={{
                fontSize: 11, color: 'var(--text-muted)',
                background: 'transparent', border: 'none',
                cursor: 'pointer', padding: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.vtt,.srt,.md,text/plain"
        onChange={onFile}
        style={{ display: 'none' }}
      />

      <textarea
        name="onboarding_transcript"
        rows={6}
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Paste the discovery / kickoff meeting transcript here, or upload a .txt/.vtt/.srt export."
        style={{ resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}
      />

      {err && (
        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{err}</div>
      )}
    </div>
  )
}
