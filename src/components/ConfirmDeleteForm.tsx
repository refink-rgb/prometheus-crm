'use client'

import { useRef } from 'react'
import { useConfirm } from './ConfirmDialog'

export default function ConfirmDeleteForm({
  action,
  message,
  children,
}: {
  action: (formData: FormData) => Promise<void>
  message: string
  children: React.ReactNode
}) {
  const confirm = useConfirm()
  const bypassRef = useRef(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (bypassRef.current) {
      bypassRef.current = false
      return
    }
    e.preventDefault()
    const form = e.currentTarget
    const ok = await confirm({ message, danger: true, confirmLabel: 'Delete' })
    if (ok) {
      bypassRef.current = true
      form.requestSubmit()
    }
  }

  return (
    <form action={action} onSubmit={handleSubmit}>
      {children}
    </form>
  )
}
