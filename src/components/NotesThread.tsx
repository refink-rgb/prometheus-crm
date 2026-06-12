'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addInternalNote, addProjectComment } from '@/lib/actions'
import type { ProjectComment } from '@/lib/types'

export default function NotesThread({
  notes,
  mode,
  projectId,
  brandId,
  token,
  currentUserName,
}: {
  notes: ProjectComment[]
  mode: 'internal' | 'client'
  projectId?: string
  brandId?: string
  token?: string
  currentUserName?: string
}) {
  const [content, setContent] = useState('')
  const [authorName, setAuthorName] = useState(currentUserName ?? '')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    try {
      if (mode === 'internal' && projectId && brandId) {
        await addInternalNote(projectId, brandId, content.trim(), authorName)
      } else if (mode === 'client' && token) {
        await addProjectComment(token, authorName, content.trim(), { track: 'note' })
      }
      setContent('')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16, maxHeight: 320, overflowY: 'auto' }}>
        {notes.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            No notes yet.
          </p>
        ) : (
          notes.map(note => (
            <div key={note.id} style={{ display: 'flex', gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: `hsl(${note.author_name.charCodeAt(0) * 37 % 360}, 55%, 35%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'white',
              }}>
                {note.author_name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{note.author_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' '}
                    {new Date(note.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, wordBreak: 'break-word' }}>
                  {note.content}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        {mode === 'client' && (
          <input
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            placeholder="Your name"
            required
            style={{ fontSize: 13 }}
          />
        )}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          required
          style={{ resize: 'vertical', fontSize: 13 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={saving || !content.trim() || (mode === 'client' && !authorName.trim())}
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {saving ? 'Posting...' : 'Post note'}
          </button>
        </div>
      </form>
    </div>
  )
}
