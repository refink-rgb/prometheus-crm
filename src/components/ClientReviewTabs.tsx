'use client'

// Tabbed shell for the client review page (/review/[token]) — the same tab
// idiom the internal project workspace uses, so the two surfaces feel like
// one product. The page grew four full sections; a client landing on it for
// the second time wants "the creatives", not a scroll hunt.
//
// The sections themselves stay SERVER-RENDERED: the page composes them as
// JSX and passes them in as slots; this component only owns which one shows.
// The Results tab exists only when the team pushed results (slot is null
// otherwise), so nothing here leaks its existence early.

import { useState } from 'react'

type TabId = 'lp' | 'creatives' | 'results' | 'offer' | 'notes'

export default function ClientReviewTabs({
  lp,
  creatives,
  results,
  offer,
  notes,
  creativesCount,
  lpOpenCount,
  notesCount,
}: {
  lp: React.ReactNode
  creatives: React.ReactNode
  /** Null until the team pushes results — the tab does not render at all. */
  results: React.ReactNode | null
  /** Null when the project carries no offer fields yet — tab hidden. */
  offer: React.ReactNode | null
  notes: React.ReactNode
  creativesCount: number
  /** Open landing-page feedback items — the badge that says "you have
   *  something to look at here". */
  lpOpenCount: number
  notesCount: number
}) {
  const [tab, setTab] = useState<TabId>('lp')

  const tabs: Array<[TabId, string, number | null]> = [
    ['lp', 'Landing Page', lpOpenCount || null],
    ['creatives', 'Creatives', creativesCount || null],
    ...(results !== null ? [['results', 'Results', null] as [TabId, string, number | null]] : []),
    ...(offer !== null ? [['offer', 'Offer', null] as [TabId, string, number | null]] : []),
    ['notes', 'Notes', notesCount || null],
  ]

  return (
    <div>
      <div style={{
        display: 'flex', gap: 24, borderBottom: '1px solid var(--border)',
        marginBottom: 24, overflowX: 'auto', overflowY: 'hidden',
      }}>
        {tabs.map(([k, label, count]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 12px',
            fontSize: 13, fontWeight: tab === k ? 700 : 500, whiteSpace: 'nowrap',
            color: tab === k ? 'var(--text-primary)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
            marginBottom: -1, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {label}
            {count ? (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10,
                background: 'var(--surface-raised)', color: 'var(--text-secondary)',
              }}>
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* All slots stay mounted; hidden ones are display:none so tab switches
          never lose a half-written comment or replay the panels' fetches. */}
      <div hidden={tab !== 'lp'}>{lp}</div>
      <div hidden={tab !== 'creatives'}>{creatives}</div>
      {results !== null && <div hidden={tab !== 'results'}>{results}</div>}
      {offer !== null && <div hidden={tab !== 'offer'}>{offer}</div>}
      <div hidden={tab !== 'notes'}>{notes}</div>
    </div>
  )
}
