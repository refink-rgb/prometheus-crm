import Link from 'next/link'
import { signOut } from '@/lib/actions'
import SignOutButton from './SignOutButton'

interface NavProps {
  email?: string | null
}

export default function Nav({ email }: NavProps) {
  return (
    <nav style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      padding: '0 24px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <div style={{
          width: 28, height: 28,
          background: 'var(--accent)',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 14, color: 'white', flexShrink: 0,
        }}>P</div>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Prometheus
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>by CTC</span>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {email ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{email}</span>
            <form action={signOut}>
              <SignOutButton />
            </form>
          </>
        ) : (
          <Link href="/login" className="btn-secondary" style={{ padding: '6px 14px', fontSize: 13 }}>
            Sign in
          </Link>
        )}
      </div>
    </nav>
  )
}
