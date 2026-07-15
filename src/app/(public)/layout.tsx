import { ToastProvider } from '@/components/Toast'
import { ConfirmDialogHost } from '@/components/ConfirmDialog'

// Mirrors the provider stack in (app)/layout.tsx. Client-facing pages take the
// same destructive actions the internal app does — approve, confirm, delete —
// so they get the same styled dialog and toasts rather than native confirm().
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmDialogHost>{children}</ConfirmDialogHost>
    </ToastProvider>
  )
}
