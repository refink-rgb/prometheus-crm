import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { countBoard, loadBoard, resolveStatusToken } from '@/lib/status/server'
import { StatusShell, Tile, Tiles } from '@/components/status/StatusShell'

// A profit engineer's status board: every active brand they own, and how many
// of its projects are ready, in the works or late. Read-only, no account. The
// token in the URL is the key (derived from their approval token, see
// lib/status/server.ts), so this reads through the service role.
//
// Computed per request: a project that moved a minute ago is right on reload.

export const metadata: Metadata = { title: 'Project status', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function StatusHomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) notFound()

  const brands = (await loadBoard(service, engineer)) ?? []
  const total = countBoard(brands.flatMap(b => b.projects))

  return (
    <StatusShell>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
        Project status · {engineer}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        {brands.length === 0
          ? 'No active brands are assigned to you yet.'
          : `${brands.length} brand${brands.length === 1 ? '' : 's'}. Open one to see each project and download the files the client approved.`}
      </p>

      {brands.length > 0 && (
        <>
          <Tiles>
            <Tile label="Ready to launch" value={total.ready} unit="project" tone="good" />
            <Tile label="In the works" value={total.working + total.upcoming} unit="project" />
            <Tile label="Running late" value={total.late} unit="project" tone="bad" />
            <Tile label="Approved by the client" value={total.approvedFiles} unit="file" />
          </Tiles>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {brands.map(brand => {
              const c = countBoard(brand.projects)
              const ready = brand.projects.filter(p => p.bucket === 'ready')
              const late = brand.projects.filter(p => p.late > 0)
              return (
                <Link
                  key={brand.id}
                  href={`/status/${token}/${brand.id}`}
                  className="card brand-card"
                  style={{ display: 'block', padding: 'var(--space-5) var(--space-6)', textDecoration: 'none' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                      {brand.name}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Open →
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <Count n={c.ready} label="ready to launch" color="var(--success)" />
                    <Count n={c.working + c.upcoming} label="in the works" color="var(--text-secondary)" />
                    <Count n={c.late} label="running late" color="var(--danger)" />
                    <Count n={c.launched} label="launched" color="var(--text-muted)" />
                    <Count n={c.approvedFiles} label={`approved file${c.approvedFiles === 1 ? '' : 's'}`} color="var(--text-muted)" />
                  </div>
                  {ready.length > 0 && (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 10 }}>
                      <strong style={{ color: 'var(--success)', fontWeight: 600 }}>Ready:</strong>{' '}
                      {ready.map(p => p.name).join(', ')}
                    </p>
                  )}
                  {late.length > 0 && (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 6 }}>
                      <strong style={{ color: 'var(--danger)', fontWeight: 600 }}>Late:</strong>{' '}
                      {late.map(p => `${p.name} (${p.late} day${p.late === 1 ? '' : 's'})`).join(', ')}
                    </p>
                  )}
                  {brand.projects.length === 0 && (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 10 }}>
                      No projects yet.
                    </p>
                  )}
                </Link>
              )
            })}
          </div>
        </>
      )}
    </StatusShell>
  )
}

/** "3 ready to launch". Zeros are left out so the card only says what is true. */
function Count({ n, label, color }: { n: number; label: string; color: string }) {
  if (n === 0) return null
  return (
    <span style={{
      fontSize: 'var(--text-sm)', fontWeight: 600, color,
      background: 'var(--surface-raised)', border: '1px solid var(--border)',
      borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap',
    }}>
      {n} {label}
    </span>
  )
}
