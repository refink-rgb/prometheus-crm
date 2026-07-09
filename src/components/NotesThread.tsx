'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { addInternalNote, addProjectComment, deleteProjectComment } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import type { ProjectComment } from '@/lib/types'

interface PendingAttachment {
  url: string
  preview: string
}

export default function NotesThread({
  notes,
  mode,
  projectId,
  brandId,
  token,
  currentUserName,
  canDelete = false,
}: {
  notes: ProjectComment[]
  mode: 'internal' | 'client'
  projectId?: string
  brandId?: string
  token?: string
  currentUserName?: string
  canDelete?: boolean
}) {
  const [content, setContent] = useState('')
  const [authorName, setAuthorName] = useState(currentUserName ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleDelete(id: string) {
    if (!token) return
    if (!confirm('Delete this note? This cannot be undone.')) return
    try {
      await deleteProjectComment(id, token)
      router.refresh()
    } catch {
      /* swallow — next refresh restores state */
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError('')
    const supabase = createClient()
    const uploaded: PendingAttachment[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) { setUploadError('Only image files are allowed.'); continue }
      if (file.size > 10 * 1024 * 1024) { setUploadError('Each image must be under 10MB.'); continue }
      const ext = file.name.split('.').pop() || 'png'
      const path = `note-attachments/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('project-images').upload(path, file)
      if (error) { setUploadError(error.message); continue }
      const { data } = supabase.storage.from('project-images').getPublicUrl(path)
      uploaded.push({ url: data.publicUrl, preview: URL.createObjectURL(file) })
    }
    setAttachments(prev => [...prev, ...uploaded])
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim() && attachments.length === 0) return
    setSaving(true)
    try {
      const urls = attachments.map(a => a.url)
      if (mode === 'internal' && projectId && brandId) {
        await addInternalNote(projectId, brandId, content.trim(), authorName, urls.length > 0 ? urls : null)
      } else if (mode === 'client' && token) {
        await addProjectComment(token, authorName, content.trim(), { track: 'note', attachment_urls: urls })
      }
      setContent('')
      setAttachments([])
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
                  {canDelete && mode === 'client' && token && (
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      aria-label="Delete note"
                      title="Delete note"
                      style={{
                        marginLeft: 'auto', background: 'none', border: 'none',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: 14, padding: '0 4px', lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {note.content && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, wordBreak: 'break-word' }}>
                    {note.content}
                  </div>
                )}
                {note.attachment_urls && note.attachment_urls.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {note.attachment_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'block', width: 64, height: 64, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Attachment ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.requestSubmit()
          }
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}
      >
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
          style={{ resize: 'vertical', fontSize: 13 }}
        />

        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {attachments.map((a, i) => (
              <div key={i} style={{ position: 'relative', width: 48, height: 48 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.preview} alt={`Pending ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label="Remove attachment"
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white',
                    fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {uploadError && <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{uploadError}</p>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              fontSize: 12, padding: '6px 10px', background: 'none',
              border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            {uploading ? 'Uploading…' : '📎 Attach image'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
          <button
            type="submit"
            disabled={saving || uploading || (!content.trim() && attachments.length === 0) || (mode === 'client' && !authorName.trim())}
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
