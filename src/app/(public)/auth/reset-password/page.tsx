import Link from 'next/link'
import { getCachedUser } from '@/lib/supabase/server'
import ResetPasswordForm from '@/components/ResetPasswordForm'
import BrandMark from '@/components/BrandMark'

export default async function ResetPasswordPage() {
  const user = await getCachedUser()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <BrandMark size={36} />
            <span style={{ fontWeight: 700, fontSize: 20, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Prometheus
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Common Thread Collective · Static Studio
          </p>
        </div>

        {user ? (
          <ResetPasswordForm />
        ) : (
          <div className="card text-center">
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: 'var(--text-primary)' }}>
              Link expired
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              This password reset link is no longer valid. Request a new one from the sign-in page.
            </p>
            <Link href="/login" className="btn-secondary" style={{ justifyContent: 'center' }}>
              ← Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
