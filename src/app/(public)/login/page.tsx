'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import BrandMark from '@/components/BrandMark'

type Mode = 'magic' | 'password'

const tabStyle: React.CSSProperties = {
  flex: 1,
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  transition: 'all 0.15s',
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('magic')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setResetSent(false)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      window.location.href = '/'
    }
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email above first.')
      return
    }
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setResetSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        {/* Logo / Wordmark */}
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

        {sent ? (
          <div className="card text-center">
            <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: 'var(--text-primary)' }}>
              Check your email
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
              We sent a magic link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
              Click it to sign in — no password needed.
            </p>
          </div>
        ) : resetSent ? (
          <div className="card text-center">
            <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: 'var(--text-primary)' }}>
              Check your email
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              We sent a password reset link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
              Follow it to set a password.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => switchMode('password')}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <div className="card">
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => switchMode('magic')}
                style={{
                  ...tabStyle,
                  borderColor: mode === 'magic' ? 'var(--accent)' : 'var(--border)',
                  background: mode === 'magic' ? 'var(--accent-muted)' : 'transparent',
                  color: mode === 'magic' ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                Magic Link
              </button>
              <button
                type="button"
                onClick={() => switchMode('password')}
                style={{
                  ...tabStyle,
                  borderColor: mode === 'password' ? 'var(--accent)' : 'var(--border)',
                  background: mode === 'password' ? 'var(--accent-muted)' : 'transparent',
                  color: mode === 'password' ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                Password
              </button>
            </div>

            {mode === 'magic' ? (
              <>
                <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 4, color: 'var(--text-primary)' }}>
                  Sign in
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
                  Enter your CTC email to receive a magic link.
                </p>

                <form onSubmit={handleMagicLink}>
                  <div style={{ marginBottom: 16 }}>
                    <label htmlFor="email">Email address</label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@commonthreadco.com"
                      required
                      autoFocus
                    />
                  </div>

                  {error && (
                    <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  )}

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading || !email}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {loading ? 'Sending…' : 'Send magic link'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 4, color: 'var(--text-primary)' }}>
                  Sign in
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
                  Enter your email and password.
                </p>

                <form onSubmit={handlePasswordSignIn}>
                  <div style={{ marginBottom: 16 }}>
                    <label htmlFor="email-pw">Email address</label>
                    <input
                      id="email-pw"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@commonthreadco.com"
                      required
                      autoFocus
                    />
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <label htmlFor="password">Password</label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </div>

                  <div style={{ marginBottom: 16, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={loading}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>

                  {error && (
                    <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  )}

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading || !email || !password}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
