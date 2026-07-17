import { redirect } from 'next/navigation'
import { getCachedUser } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { isJobEditor } from '@/lib/types'
import { signOut } from '@/lib/actions'
import Sidebar from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toast'
import { ConfirmDialogHost } from '@/components/ConfirmDialog'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCachedUser()
  if (!user) redirect('/login')

  const isEditor = canEdit(user.email)

  // RLS grants any authenticated user full read/write — canEdit() is the only
  // access boundary in the app. Without this check, anyone who signs in (even
  // a self-created account, see login/page.tsx) could view every brand,
  // project, and financial figure in the CRM even though they can't mutate.
  if (!isEditor) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
            Access restricted
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{user.email}</strong> isn&apos;t authorized to
            access Prometheus. Ask an admin to add you.
          </p>
          <form action={signOut}>
            <button type="submit" className="btn-secondary">Sign out</button>
          </form>
        </div>
      </div>
    )
  }

  const profiles = await getCachedProfiles()
  const myProfile = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  const showFinancials = isEditor && !isJobEditor(myProfile)

  return (
    <ToastProvider>
      <ConfirmDialogHost>
        <div style={{ minHeight: '100vh' }}>
          <Sidebar email={user.email ?? null} showFinancials={showFinancials} />
          <div className="app-main" style={{ marginLeft: 220, minHeight: '100vh' }}>
            {children}
          </div>
        </div>
      </ConfirmDialogHost>
    </ToastProvider>
  )
}
