'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string }

type ToastContextValue = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const KIND_BORDER: Record<ToastKind, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  info: 'var(--accent)',
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, kind, message }])
    setTimeout(() => dismiss(id), 4500)
  }, [dismiss])

  const value: ToastContextValue = {
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-live="polite"
            style={{
              position: 'fixed',
              bottom: 16,
              right: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              zIndex: 1000,
              maxWidth: 360,
            }}
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${KIND_BORDER[t.kind]}`,
                  borderRadius: 8,
                  padding: 'var(--space-3) var(--space-4)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-primary)',
                  boxShadow: '0 6px 20px var(--hover-shadow)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-2)',
                }}
              >
                <span style={{ flex: 1 }}>{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="focus-ring-pill"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    width: 20,
                    height: 20,
                    padding: 0,
                    fontSize: 'var(--text-md)',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  )
}
