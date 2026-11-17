'use client'

// "Updated 3:42 PM" in the reader's own time zone. The server only knows UTC,
// so the time is read on the client: the server render (and the first client
// pass, to match it) is empty rather than wrong.

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

export default function UpdatedAt({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
    () => '',
  )
  return (
    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', minHeight: '1.2em' }}>
      {text && <>Updated {text} · reload for the latest</>}
    </span>
  )
}
