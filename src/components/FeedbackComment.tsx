'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toggleCommentResolved } from '@/lib/actions'
import { useToast } from '@/components/Toast'
import { Check, ExternalLink, MapPin, MessageSquare } from 'lucide-react'
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
  pinned = pin != null,
  pinHref,
}: {
  comment: ProjectComment
  projectId: string
  brandId: string
  canResolve: boolean
  /** The marker number this comment carries on the client's page. */
  pin?: number
  /** Pinned, but carrying no number any more (resolved: off the client link). */
  pinned?: boolean
  /** Opens the client review link with this pin selected and scrolled into
   *  view — the only way for the team to see WHERE on the page it points. */
  pinHref?: string
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
          <span title={`Pin ${pin} on the client's page`} style={{
            width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0,
          }}>{pin}</span>
        ) : pinned ? (
          <MapPin size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
        ) : (
          <MessageSquare size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden />
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
            <Check size={12} strokeWidth={3} aria-hidden />
          </button>
        )}
      </div>
      {/* Where it points. The pin number alone said "this one is pinned" and
          nothing else — the position never left the client link, so the team
          read pinned feedback as a plain note. */}
      {pinned && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          <MapPin size={12} aria-hidden />
          <span>Pinned to a spot on the page{comment.section_tag && comment.section_tag !== 'General' ? ` · ${comment.section_tag}` : ''}</span>
          {pinHref && (
            <a
              href={pinHref}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
            >
              See on page <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </div>
      )}
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
