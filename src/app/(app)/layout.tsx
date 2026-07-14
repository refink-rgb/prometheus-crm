import { getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import Sidebar from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toast'
import { ConfirmDialogHost } from '@/components/ConfirmDialog'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCachedUser()
  const isEditor = canEdit(user?.email)

  return (
    <ToastProvider>
      <ConfirmDialogHost>
        <div style={{ minHeight: '100vh' }}>
          <Sidebar email={user?.email ?? null} canEdit={isEditor} />
          <div className="app-main" style={{ marginLeft: 220, minHeight: '100vh' }}>
            {children}
          </div>
        </div>
      </ConfirmDialogHost>
    </ToastProvider>
  )
}
