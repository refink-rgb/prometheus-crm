'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toggleCommentResolved } from '@/lib/actions'
import { useToast } from '@/components/Toast'
import type { ProjectComment } from '@/lib/types'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// One client-feedback item with a resolve/check toggle. The check is internal
// only (canResolve = the viewer can edit); ticking it dims + strikes the item
// so the team can see at a glance what's still open.
export default function FeedbackComment({
  comment,
  projectId,
  brandId,
  canResolve,
  pin,
}: {
  comment: ProjectComment
  projectId: string
  brandId: string
  canResolve: boolean
  pin?: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [resolved, setResolved] = useState(comment.resolved_at != null)
  const [pending, setPending] = useState(false)

  async function toggle() {
    const next = !resolved
    setResolved(next)
    setPending(true)
    try {
      await toggleCommentResolved(comment.id, projectId, brandId, next)
      router.refresh()
    } catch {
      setResolved(!next)
      toast.error("Couldn't update that. Please try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      border: `1px solid ${resolved ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'var(--border)'}`,
      background: resolved ? 'color-mix(in srgb, var(--success) 7%, transparent)' : 'var(--surface-raised)',
      opacity: resolved ? 0.72 : 1,
      transition: 'opacity 0.15s, background 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {pin != null ? (
          <span style={{
            width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0,
          }}>{pin}</span>
        ) : (
          <span style={{ fontSize: 12, flexShrink: 0 }}>💬</span>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{comment.author_name}</span>
        {comment.section_tag && comment.section_tag !== 'General' && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--accent)',
            background: 'var(--accent-muted)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            borderRadius: 4, padding: '1px 6px',
          }}>{comment.section_tag}</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(comment.created_at)}</span>
        {canResolve && (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            aria-label={resolved ? 'Mark as not done' : 'Mark feedback done'}
            title={resolved ? 'Resolved — click to reopen' : 'Mark this feedback done'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              cursor: pending ? 'wait' : 'pointer', padding: 0,
              border: `1.5px solid ${resolved ? 'var(--success)' : 'var(--border)'}`,
              background: resolved ? 'var(--success)' : 'transparent',
              color: resolved ? 'white' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700, lineHeight: 1,
            }}
          >
            ✓
          </button>
        )}
      </div>
      <p style={{
        fontSize: 13, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap',
        color: 'var(--text-secondary)',
        textDecoration: resolved ? 'line-through' : 'none',
        textDecorationColor: 'color-mix(in srgb, var(--text-muted) 60%, transparent)',
      }}>
        {comment.content}
      </p>
    </div>
  )
}
