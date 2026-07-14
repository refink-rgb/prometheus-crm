'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void }

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmDialogHost')
  return ctx
}

export function ConfirmDialogHost({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const close = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok)
      return null
    })
  }, [])

  useEffect(() => {
    if (!pending) return
    confirmButtonRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, close])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => close(false)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-message"
              className="card"
              style={{ maxWidth: 400, width: '90%' }}
              onClick={(e) => e.stopPropagation()}
            >
              {pending.title && (
                <h2 id="confirm-dialog-title" style={{ fontSize: 'var(--text-md)', fontWeight: 600, margin: '0 0 var(--space-2)' }}>
                  {pending.title}
                </h2>
              )}
              <p id="confirm-dialog-message" style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', margin: '0 0 var(--space-5)' }}>
                {pending.message}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                <button type="button" className="btn-secondary" onClick={() => close(false)}>
                  {pending.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className={pending.danger ? 'btn-danger' : 'btn-primary'}
                  onClick={() => close(true)}
                >
                  {pending.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  )
}
