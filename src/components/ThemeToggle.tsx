'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
const STORAGE_KEY = 'prometheus-theme'

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  // The pre-hydration script (in layout.tsx) is the source of truth — trust
  // the class on <html> rather than reading localStorage again here.
  return document.documentElement.classList.contains('theme-light') ? 'light' : 'dark'
}

// `compact` renders a 30px icon-only square for the collapsed sidebar rail.
export default function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  // Start with 'dark' during SSR and on the very first client render to keep
  // hydration deterministic; then sync from the DOM in an effect.
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    // Sync from the DOM after hydration — the pre-hydration script in
    // layout.tsx already applied the persisted class before React mounted,
    // so this read is the authoritative first value on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readInitialTheme())
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    if (next === 'light') {
      document.documentElement.classList.add('theme-light')
    } else {
      document.documentElement.classList.remove('theme-light')
    }
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* storage blocked — theme still applies for the session */ }
  }

  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: 'transparent',
        color: 'var(--text-muted)',
        border: '1px solid var(--sidebar-border)',
        borderRadius: 6,
        padding: compact ? 0 : '5px 10px',
        width: compact ? 30 : undefined,
        height: compact ? 30 : undefined,
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'border-color 0.12s, color 0.12s',
      }}
    >
      {isLight ? <SunIcon /> : <MoonIcon />}
      {!compact && <span>{isLight ? 'Light' : 'Dark'}</span>}
    </button>
  )
}

function MoonIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  )
}
