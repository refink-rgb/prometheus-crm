import { redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canEdit, canViewCapacity } from '@/lib/permissions'
import { getCachedProfiles } from '@/lib/profiles'
import { computeCapacity, type CapacityProject } from '@/lib/capacity'
import { isJobEditor } from '@/lib/types'
import { signOut } from '@/lib/actions'
import Sidebar from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toast'
import { ConfirmDialogHost } from '@/components/ConfirmDialog'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCachedUser()
  if (!user) redirect('/login')

  const isEditor = await canEdit(user.email)

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

  // Sidebar capacity counters are management-only; skip the extra projects
  // query entirely for everyone else.
  const showCapacity = canViewCapacity(user.email)
  const supabase = await createClient()
  const [profiles, capacityRes] = await Promise.all([
    getCachedProfiles(),
    showCapacity
      ? supabase
          .from('projects')
          .select('lp_editor_id, creative_editor_id, lp_stage, creatives_stage, is_complete')
          .eq('is_complete', false)
      : Promise.resolve({ data: null }),
  ])
  const myProfile = profiles.find(p => p.email === user.email?.toLowerCase()) ?? null
  const showFinancials = isEditor && !isJobEditor(myProfile)
  const capacity = showCapacity
    ? computeCapacity(profiles, (capacityRes.data ?? []) as CapacityProject[])
    : null

  return (
    <ToastProvider>
      <ConfirmDialogHost>
        <div style={{ minHeight: '100vh' }}>
          <Sidebar email={user.email ?? null} showFinancials={showFinancials} capacity={capacity} />
          <div className="app-main" style={{ marginLeft: 220, minHeight: '100vh' }}>
            {children}
          </div>
        </div>
      </ConfirmDialogHost>
    </ToastProvider>
  )
}
