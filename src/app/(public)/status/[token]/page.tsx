import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { countBoard, loadBoard, resolveStatusToken, type BoardBrand, type BoardProject } from '@/lib/status/server'
import { normalizeStage } from '@/lib/types'
import StagePill from '@/components/StagePill'
import { StatusShell, Tile, Tiles } from '@/components/status/StatusShell'

// A profit engineer's status board: every active brand they own. Each brand is
// one block: its name, a row of counts, then every project with its stage.
// Read-only, no account. The token in the URL is the key (derived from their
// approval token, see lib/status/server.ts), so this reads through the
// service role.
//
// Computed per request: a project that moved a minute ago is right on reload.

export const metadata: Metadata = { title: 'Project status', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The project list is a four-column table on a wide screen and a stacked card
// on a phone. Media queries cannot live in inline styles, hence the one block.
const CSS = `
.sb-row { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(0, 1.4fr) minmax(0, 2fr) 100px; gap: 12px; align-items: center; padding: 11px var(--space-6); }
.sb-head { padding-top: 8px; padding-bottom: 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); background: var(--surface-raised); border-top: 1px solid var(--border); }
a.sb-row { text-decoration: none; border-top: 1px solid var(--border); transition: background 0.12s; }
a.sb-row:hover { background: var(--surface-raised); }
.sb-due { text-align: right; }
.sb-stat { padding: 12px var(--space-6); border-left: 1px solid var(--border); }
.sb-stat:first-child { border-left: 0; }
@media (max-width: 720px) {
  .sb-head { display: none; }
  .sb-row { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 12px var(--space-4); }
  .sb-due { text-align: left; }
  .sb-stat { padding: 10px var(--space-4); }
}
`

const dueLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso.slice(0, 10) + 'T12:00:00'))

// Ready first (what can go now), then the work in flight with the latest
// first, then what has not started.
const ORDER = { ready: 0, working: 1, upcoming: 2, launched: 3 } as const
const byUrgency = (a: BoardProject, b: BoardProject) =>
  ORDER[a.bucket] - ORDER[b.bucket] || b.late - a.late || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9')

export default async function StatusHomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) notFound()

  const brands = (await loadBoard(service, engineer)) ?? []
  const total = countBoard(brands.flatMap(b => b.projects))

  return (
    <StatusShell>
      <style>{CSS}</style>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
        Project status · {engineer}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        {brands.length === 0
          ? 'No active brands are assigned to you yet.'
          : `${brands.length} client${brands.length === 1 ? '' : 's'}. Open a project to download the files the client approved.`}
      </p>

      {brands.length > 0 && (
        <>
          <Tiles>
            <Tile label="Ready to launch" value={total.ready} unit="project" tone="good" />
            <Tile label="In the works" value={total.working + total.upcoming} unit="project" />
            <Tile label="Running late" value={total.late} unit="project" tone="bad" />
            <Tile label="Launched" value={total.launched} unit="project" />
          </Tiles>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {brands.map(brand => <BrandBlock key={brand.id} brand={brand} token={token} />)}
          </div>
        </>
      )}
    </StatusShell>
  )
}

function BrandBlock({ brand, token }: { brand: BoardBrand; token: string }) {
  const c = countBoard(brand.projects)
  const open = brand.projects.filter(p => p.bucket !== 'launched').sort(byUrgency)
  // Latest launch first.
  const launched = brand.projects.filter(p => p.bucket === 'launched').reverse()
  const initials = brand.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const hue = [...brand.name].reduce((n, ch) => n + ch.charCodeAt(0), 0) * 7 % 360
  const href = `/status/${token}/${brand.id}`

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Client name */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        padding: 'var(--space-5) var(--space-6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div aria-hidden style={{
            width: 38, height: 38, borderRadius: 9, flexShrink: 0,
            background: `hsl(${hue}, 55%, 30%)`, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
          }}>
            {initials}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0 }}>
            {brand.name}
          </h2>
        </div>
        <Link href={href} className="btn-secondary btn-sm" style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>
          Open client and downloads →
        </Link>
      </div>

      {/* Quick summary */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        borderTop: '1px solid var(--border)',
      }}>
        <Stat n={c.ready} label="Ready to launch" color="var(--success)" />
        <Stat n={c.working + c.upcoming} label="In the works" color="var(--text-primary)" />
        <Stat n={c.late} label="Running late" color="var(--danger)" />
        <Stat n={c.launched} label="Launched" color="var(--text-primary)" />
        <Stat n={c.approvedFiles} label="Approved files" color="var(--text-primary)" />
      </div>

      {/* Projects and their stage */}
      {brand.projects.length === 0 ? (
        <p style={{
          fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0,
          padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border)',
        }}>
          No projects yet.
        </p>
      ) : (
        <>
          {open.length > 0 && (
            <div className="sb-row sb-head">
              <span>Project</span>
              <span>Status</span>
              <span>Stage</span>
              <span className="sb-due">Due</span>
            </div>
          )}
          {open.map(p => <ProjectRow key={p.id} project={p} href={`${href}#p-${p.id}`} />)}
          {open.length === 0 && (
            <p style={{
              fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0,
              padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border)',
            }}>
              Nothing in the works right now.
            </p>
          )}
          {launched.length > 0 && (
            <details style={{ borderTop: '1px solid var(--border)' }}>
              <summary style={{
                cursor: 'pointer', padding: '11px var(--space-6)',
                fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)',
              }}>
                Launched ({launched.length})
              </summary>
              {launched.map(p => <ProjectRow key={p.id} project={p} href={`${href}#p-${p.id}`} />)}
            </details>
          )}
        </>
      )}
    </section>
  )
}

/** One number in a brand's summary strip. A zero is shown quiet. */
function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="sb-stat">
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, color: n === 0 ? 'var(--text-muted)' : color }}>
        {n}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function ProjectRow({ project: p, href }: { project: BoardProject; href: string }) {
  const dot = p.late > 0
    ? 'var(--danger)'
    : p.bucket === 'ready' ? 'var(--success)'
    : p.bucket === 'launched' ? 'var(--stage-live)'
    : p.waiting === 'Waiting on client feedback' ? 'var(--stage-client)'
    : p.bucket === 'upcoming' ? 'var(--stage-brief)'
    : 'var(--stage-progress)'

  return (
    <Link href={href} className="sb-row">
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
        {(p.pageType || p.approved.length > 0) && (
          <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            {[p.pageType, p.approved.length > 0 && `${p.approved.length} approved file${p.approved.length === 1 ? '' : 's'}`]
              .filter(Boolean).join(' · ')}
          </span>
        )}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', minWidth: 0 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        {p.waiting}
      </span>

      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {p.lpStage && <StagePill stage={normalizeStage(p.lpStage)} track="LP" />}
        {p.creativesStage && <StagePill stage={normalizeStage(p.creativesStage)} track="Creatives" />}
      </span>

      <span className="sb-due" style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
        {p.late > 0 ? (
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{p.late} day{p.late === 1 ? '' : 's'} late</span>
        ) : p.dueDate ? (
          <span style={{ color: 'var(--text-muted)' }}>{dueLabel(p.dueDate)}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </span>
    </Link>
  )
}
