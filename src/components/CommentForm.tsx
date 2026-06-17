'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addProjectComment } from '@/lib/actions'

export default function CommentForm({ token }: { token: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !content.trim()) return
    setSubmitting(true)
    try {
      await addProjectComment(token, name, content)
      setContent('')
      setDone(true)
      router.refresh()
    } catch {
      // silent — could add error state if needed
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.requestSubmit()
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {done && (
        <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, fontSize: 13, color: 'var(--success)' }}>
          ✓ Comment submitted — thank you!
        </div>
      )}
      <div>
        <label htmlFor="comment-name">Your name</label>
        <input
          id="comment-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Sarah"
          required
        />
      </div>
      <div>
        <label htmlFor="comment-content">Comment</label>
        <textarea
          id="comment-content"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          placeholder="Your feedback, questions, or requests…"
          style={{ resize: 'vertical' }}
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !name.trim() || !content.trim()}
        className="btn-secondary"
        style={{ alignSelf: 'flex-start', fontSize: 13 }}
      >
        {submitting ? 'Submitting…' : 'Submit comment'}
      </button>
    </form>
  )
}
