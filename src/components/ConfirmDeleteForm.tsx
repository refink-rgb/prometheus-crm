'use client'

export default function ConfirmDeleteForm({
  action,
  message,
  children,
}: {
  action: (formData: FormData) => Promise<void>
  message: string
  children: React.ReactNode
}) {
  function handleSubmit(e: React.FormEvent) {
    if (!confirm(message)) e.preventDefault()
  }

  return (
    <form action={action} onSubmit={handleSubmit}>
      {children}
    </form>
  )
}
