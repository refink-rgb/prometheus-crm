'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getMyNotifications, markAllNotificationsRead } from '@/lib/notification-actions'
import type { NotificationRow } from '@/lib/types'

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

export default function NotificationBell() {
  const router = useRouter()
  const [items, setItems] = useState<NotificationRow[]>([])
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const unread = items.filter(n => !n.read_at).length

  const refresh = useCallback(async () => {
    try {
      setItems(await getMyNotifications())
    } catch {
      /* table may not exist yet — leave the bell empty */
    }
  }, [])

  // Load on mount + whenever the tab regains focus.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getMyNotifications()
        if (!cancelled) setItems(data)
      } catch { /* table may not exist yet */ }
    })()
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [refresh])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      await refresh()
      if (unread > 0) {
        // Optimistically clear the badge, then persist.
        setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
        markAllNotificationsRead().catch(() => {})
      }
    }
  }

  function onItemClick(n: NotificationRow) {
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
          background: open ? 'var(--accent-muted)' : 'transparent',
          border: '1px solid var(--sidebar-border)',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          transition: 'color 0.12s, background 0.12s',
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 15, height: 15, padding: '0 3px',
            borderRadius: 8, background: 'var(--accent)', color: 'white',
            fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, width: 300,
          maxHeight: 380, overflowY: 'auto', zIndex: 50,
          background: 'var(--surface-raised)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Notifications
          </div>
          {items.length === 0 ? (
            <p style={{ padding: '20px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              You&apos;re all caught up.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 4 }}>
              {items.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                      padding: '9px 10px', borderRadius: 7, border: 'none',
                      background: n.read_at ? 'transparent' : 'var(--accent-muted)',
                      marginBottom: 2,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
                        {n.title}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.body}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
