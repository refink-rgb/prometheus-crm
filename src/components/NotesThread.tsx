'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { addInternalNote, addProjectComment, deleteProjectComment, deleteInternalNote } from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import type { ProjectComment } from '@/lib/types'

interface PendingAttachment {
  url: string
  preview: string
}

interface Mentionable {
  id: string
  name: string
}

export default function NotesThread({
  notes,
  mode,
  projectId,
  brandId,
  token,
  currentUserName,
  canDelete = false,
  mentionables = [],
}: {
  notes: ProjectComment[]
  mode: 'internal' | 'client'
  projectId?: string
  brandId?: string
  token?: string
  currentUserName?: string
  canDelete?: boolean
  mentionables?: Mentionable[]
}) {
  const [content, setContent] = useState('')
  const [authorName, setAuthorName] = useState(currentUserName ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()

  // @mention autocomplete state. mentionQuery is the text typed after the
  // active '@' (null when the caret isn't in a mention); mentionIndex is the
  // highlighted row for keyboard nav.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  const mentionMatches = mentionQuery === null
    ? []
    : mentionables
        .filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
  const mentionOpen = mentionMatches.length > 0

  // Recompute the active mention token from the text up to the caret.
  function syncMentionQuery(value: string, caret: number) {
    if (mentionables.length === 0) { setMentionQuery(null); return }
    const upto = value.slice(0, caret)
    const m = upto.match(/(?:^|\s)@([^\s@]{0,30})$/)
    setMentionQuery(m ? m[1] : null)
    setMentionIndex(0)
  }

  function onComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    syncMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
  }

  // Replace the active "@partial" with "@Full Name " and close the menu.
  function insertMention(m: Mentionable) {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? content.length
    const before = content.slice(0, caret)
    const after = content.slice(caret)
    const replaced = before.replace(/@([^\s@]{0,30})$/, `@${m.name} `)
    const next = replaced + after
    setContent(next)
    setMentionQuery(null)
    // Restore focus + place the caret right after the inserted mention.
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = replaced.length
      el.setSelectionRange(pos, pos)
    })
  }

  // Which mentionables are actually referenced in the final text.
  function resolveMentionIds(text: string): string[] {
    return mentionables.filter(m => text.includes(`@${m.name}`)).map(m => m.id)
  }

  // Highlight "@Known Name" spans when rendering a note.
  function renderMentions(text: string): React.ReactNode {
    if (mentionables.length === 0) return text
    const names = mentionables.map(m => m.name).sort((a, b) => b.length - a.length)
    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`@(${escaped.join('|')})`, 'g')
    const out: React.ReactNode[] = []
    let last = 0
    let key = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) out.push(text.slice(last, match.index))
      out.push(
        <span key={key++} style={{ color: 'var(--accent)', fontWeight: 600 }}>@{match[1]}</span>,
      )
      last = match.index + match[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [notes.length])

  async function handleDelete(id: string) {
    if (!confirm('Delete this note? This cannot be undone.')) return
    try {
      if (mode === 'client' && token) {
        await deleteProjectComment(id, token)
      } else if (mode === 'internal' && projectId && brandId) {
        await deleteInternalNote(id, projectId, brandId)
      } else {
        return
      }
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
        const mentionIds = resolveMentionIds(content)
        await addInternalNote(projectId, brandId, content.trim(), authorName, urls.length > 0 ? urls : null, mentionIds.length > 0 ? mentionIds : null)
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
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16, maxHeight: 320, overflowY: 'auto' }}>
        {notes.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            No notes yet.
          </p>
        ) : (
          notes.map((note, idx) => {
            const prev = notes[idx - 1]
            // Never group across an audience change: the "Internal" badge only
            // renders on a group's first message, so grouping an internal note
            // with a client-visible one would mislabel who can see it.
            const isGrouped = !!prev
              && prev.author_name === note.author_name
              && prev.audience === note.audience
              && new Date(note.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
            const isInternalOnly = mode === 'internal' && note.audience === 'internal'

            return (
              <div
                key={note.id}
                style={{ display: 'flex', gap: 10, marginTop: isGrouped ? 0 : 12, padding: '1px 4px', borderRadius: 6 }}
                className="note-row"
              >
                <div style={{ width: 28, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                  {!isGrouped && (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: `hsl(${note.author_name.charCodeAt(0) * 37 % 360}, 55%, 35%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: 'white',
                    }}>
                      {note.author_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {isGrouped && (
                    <span className="note-hover-time" style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0 }}>
                      {new Date(note.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {!isGrouped && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{note.author_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' '}
                        {new Date(note.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isInternalOnly && (
                        <span title="Only visible to your team, not the client" style={{
                          fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                          border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px',
                        }}>
                          🔒 Internal
                        </span>
                      )}
                    </div>
                  )}
                  {canDelete && ((mode === 'client' && token) || (mode === 'internal' && projectId && brandId)) && (
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      aria-label="Delete note"
                      title="Delete note"
                      className="note-hover-delete"
                      style={{
                        float: 'right', background: 'none', border: 'none',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: 14, padding: '0 4px', lineHeight: 1, opacity: 0,
                      }}
                    >
                      ×
                    </button>
                  )}
                  {note.content && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      {renderMentions(note.content)}
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
                          <img src={url} alt={`Attachment ${i + 1}`} loading="lazy" decoding="async" width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
      <style jsx>{`
        .note-row:hover { background: var(--surface-hover, rgba(127, 127, 127, 0.08)); }
        .note-row:hover .note-hover-time { opacity: 1; }
        .note-row:hover .note-hover-delete { opacity: 1; }
      `}</style>

      <form
        onSubmit={handleSubmit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
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
        <div style={{ position: 'relative' }}>
          {mentionOpen && (
            <ul
              role="listbox"
              style={{
                position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 4,
                listStyle: 'none', padding: 4, margin: 0, zIndex: 20,
                background: 'var(--surface-raised)', border: '1px solid var(--border)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', maxHeight: 180, overflowY: 'auto',
              }}
            >
              {mentionMatches.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    onMouseDown={e => { e.preventDefault(); insertMention(m) }}
                    onMouseEnter={() => setMentionIndex(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                      padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 13, color: 'var(--text-primary)',
                      background: i === mentionIndex ? 'var(--accent-muted)' : 'transparent',
                    }}
                  >
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      background: `hsl(${m.name.charCodeAt(0) * 37 % 360}, 55%, 35%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: 'white',
                    }}>
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={onComposerChange}
            onKeyDown={e => {
              if (!mentionOpen) return
              if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setMentionIndex(i => (i + 1) % mentionMatches.length) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setMentionIndex(i => (i - 1 + mentionMatches.length) % mentionMatches.length) }
              else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); insertMention(mentionMatches[mentionIndex] ?? mentionMatches[0]) }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMentionQuery(null) }
            }}
            placeholder={mentionables.length > 0 ? 'Add a note... (@ to mention, Shift+Enter for a new line)' : 'Add a note... (Shift+Enter for a new line)'}
            rows={2}
            style={{ resize: 'vertical', fontSize: 13, width: '100%' }}
          />
        </div>

        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {attachments.map((a, i) => (
              <div key={i} style={{ position: 'relative', width: 48, height: 48 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.preview} alt={`Pending ${i + 1}`} loading="lazy" decoding="async" width={48} height={48} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
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
            className="btn-accent-outline"
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {saving ? 'Posting...' : 'Post note'}
          </button>
        </div>
      </form>
    </div>
  )
}
