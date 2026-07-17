'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      window.location.href = '/'
    }
  }

  return (
    <div className="card">
      <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 4, color: 'var(--text-primary)' }}>
        Set a new password
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
        Choose a password for signing in to Prometheus.
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            required
            autoFocus
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            required
          />
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !password || !confirm}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loading ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </div>
  )
}
