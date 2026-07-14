'use client'

import { useFormStatus } from 'react-dom'
import Spinner from './Spinner'

export default function SubmitButton({
  children,
  pendingText,
  className,
  style,
}: {
  children: React.ReactNode
  pendingText: string
  className?: string
  style?: React.CSSProperties
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      style={style}
      aria-live="polite"
    >
      {pending ? (
        <>
          <Spinner size="sm" /> {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  )
}
