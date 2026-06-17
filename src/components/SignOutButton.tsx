'use client'

import { useFormStatus } from 'react-dom'

export default function SignOutButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="btn-secondary"
      disabled={pending}
      style={{ padding: '6px 14px', fontSize: 13, cursor: pending ? 'wait' : 'pointer' }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
