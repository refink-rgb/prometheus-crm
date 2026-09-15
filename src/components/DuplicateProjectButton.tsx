'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { duplicateProject } from '@/lib/actions'

// One click, then you are standing in the copy. No confirm: duplicating only
// creates, and the copy is named "(copy)" and starts at brief, so a mistaken
// click costs one Delete, not anyone's work.

export default function DuplicateProjectButton({ projectId, brandId }: { projectId: string; brandId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  return (
    <>
      <button
        onClick={() => {
          setErr('')
          startTransition(async () => {
            try {
              const r = await duplicateProject(projectId, brandId)
              if (!r.ok) { setErr(r.error); return }
              router.push(r.href)
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Could not duplicate.')
            }
          })
        }}
        disabled={pending}
        className="btn-secondary"
        title="Copy the brief, offer, products, copy deck, links and reference images into a new project at Brief"
        style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', cursor: pending ? 'wait' : 'pointer' }}
      >
        <Copy size={14} strokeWidth={2} aria-hidden /> {pending ? 'Duplicating…' : 'Duplicate'}
      </button>
      {err && <span role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{err}</span>}
    </>
  )
}
