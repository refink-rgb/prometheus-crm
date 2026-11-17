import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/service'
import { countBoard, loadBoard, resolveStatusToken, type BoardBrand, type BoardProject } from '@/lib/status/server'
import { safeName, STAGE_PLAIN, statusLine, type Tone } from '@/lib/status/board'
import { normalizeStage, type Stage } from '@/lib/types'
import { STAGE_PCT } from '@/lib/stageColors'
import CopyText from '@/components/status/CopyText'
import DownloadApproved from '@/components/status/DownloadApproved'
import UpdatedAt from '@/components/status/UpdatedAt'
import { StatusShell } from '@/components/status/StatusShell'

// A profit engineer's status board. Top to bottom, in the order a strategist
// needs it:
//   1. filters with counts       what is ready, with the client, with us
//   2. "Needs you"               the few projects they can act on right now
//   3. every client              name, one-line summary, each project
//
// Read-only, no account. The token in the URL is the key (derived from their
// approval token, see lib/status/server.ts), so this reads through the
// service role. Computed per request: a project that moved a minute ago is
// right on reload.
//
// Filters are plain links (?show=ready), not client state: a filtered view has
// its own URL to share, and an AI agent reading the page can follow it.

export const metadata: Metadata = { title: 'Project status', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// Media queries, :hover and the <details> marker cannot live in inline styles.
const CSS = `
.sb-chip { display: inline-flex; align-items: center; gap: 7px; font-size: var(--text-sm); font-weight: 600; padding: 6px 13px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); text-decoration: none; white-space: nowrap; transition: border-color 0.12s, color 0.12s; }
.sb-chip:hover { border-color: var(--border-hover); color: var(--text-primary); }
.sb-chip[aria-current="page"] { background: var(--accent-muted); border-color: var(--accent); color: var(--accent); }
.sb-chip b { font-weight: 700; opacity: 0.75; }
.sb-row { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.45fr) auto; gap: 16px; align-items: center; padding: 13px var(--space-6); border-top: 1px solid var(--border); }
.sb-row:hover { background: var(--surface-raised); }
.sb-need { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px var(--space-6); border-top: 1px solid var(--border); }
.sb-need:first-child { border-top: 0; }
.sb-name { color: var(--text-primary); text-decoration: none; }
.sb-name:hover { text-decoration: underline; }
.sb-url { color: var(--accent); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.sb-url:hover { text-decoration: underline; }
.sb-actions { display: flex; gap: 8px; align-items: flex-start; justify-content: flex-end; min-width: 176px; }
.sb-client > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: var(--space-4) var(--space-6); }
.sb-client > summary::-webkit-details-marker { display: none; }
.sb-client > summary:hover { background: var(--surface-raised); }
.sb-client > summary:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.sb-chevron { color: var(--text-muted); flex-shrink: 0; transition: transform 0.15s; }
.sb-client[open] > summary .sb-chevron { transform: rotate(180deg); }
.sb-more > summary { cursor: pointer; padding: 11px var(--space-6); font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); border-top: 1px solid var(--border); }
@media (max-width: 720px) {
  .sb-row { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 13px var(--space-4); }
  .sb-need { flex-direction: column; align-items: flex-start; gap: 10px; padding: 13px var(--space-4); }
  .sb-actions { justify-content: flex-start; min-width: 0; flex-wrap: wrap; }
  .sb-client > summary, .sb-more > summary { padding-left: var(--space-4); padding-right: var(--space-4); }
}
`

const TONE: Record<Tone, string> = {
  good: 'var(--success)',
  warn: 'var(--stage-client-text)',
  bad: 'var(--danger)',
  plain: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
}

// "Needs you" is a short list on purpose: past this it stops being a list of
// things to do and becomes the whole board again. The rest is one click away.
const NEEDS_SHOWN = 6

type Show = 'all' | 'ready' | 'client' | 'team' | 'launched'
const SHOWS: Show[] = ['all', 'ready', 'client', 'team', 'launched']
const matches = (p: BoardProject, show: Show) =>
  show === 'all' ? p.bucket !== 'launched'
  : show === 'ready' ? p.bucket === 'ready'
  : show === 'launched' ? p.bucket === 'launched'
  : p.holder === show

/** "brand.com/pages/sale": a web address the way people say it. */
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
const dueLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso.slice(0, 10) + 'T12:00:00'))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// What can go now, then what the team owes late, then the client's longest
// wait, then the rest by due date.
const ORDER = { ready: 0, working: 1, upcoming: 2, launched: 3 } as const
const byUrgency = (a: BoardProject, b: BoardProject) =>
  ORDER[a.bucket] - ORDER[b.bucket]
  || b.late - a.late
  || (b.waitingDays ?? -1) - (a.waitingDays ?? -1)
  || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9')

export default async function StatusHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ show?: string }>
}) {
  const { token } = await params
  const { show: rawShow } = await searchParams
  const show: Show = SHOWS.includes(rawShow as Show) ? (rawShow as Show) : 'all'

  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) notFound()

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const origin = `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')}://${host}`

  const brands = (await loadBoard(service, engineer)) ?? []
  const all = brands.flatMap(b => b.projects)
  const total = countBoard(all)
  const brandName = new Map(brands.map(b => [b.id, b.name]))

  // The short list a strategist can act on: launch it, or chase the client.
  const needs = all.filter(p => p.bucket === 'ready' || p.holder === 'client').sort(byUrgency)

  // Clients with something to act on come first; the rest by name.
  const weight = (b: BoardBrand) => {
    const c = countBoard(b.projects)
    return c.ready * 10_000 + c.late * 100 + c.client
  }
  const withProjects = brands
    .filter(b => b.projects.some(p => matches(p, show)) || (show === 'all' && b.projects.length > 0))
    .sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name))
  const empty = brands.filter(b => b.projects.length === 0)

  const chip = (key: Show, label: string, n: number) => (
    <Link
      key={key}
      href={key === 'all' ? `/status/${token}` : `/status/${token}?show=${key}`}
      className="sb-chip"
      aria-current={show === key ? 'page' : undefined}
    >
      {label} <b>{n}</b>
    </Link>
  )

  return (
    <StatusShell>
      <style>{CSS}</style>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', margin: 0 }}>
          Project status · {engineer}
        </h1>
        <UpdatedAt iso={new Date().toISOString()} />
      </div>

      {brands.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 10 }}>No active clients are assigned to you yet.</p>
      ) : (
        <>
          <nav aria-label="Filter projects" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: 'var(--space-5) 0 var(--space-8)' }}>
            {chip('all', 'All open', total.ready + total.working + total.upcoming)}
            {chip('ready', 'Ready to launch', total.ready)}
            {chip('client', 'Waiting on client', total.client)}
            {chip('team', 'With our team', total.team)}
            {chip('launched', 'Launched', total.launched)}
          </nav>

          {show === 'all' && needs.length > 0 && (
            <section aria-labelledby="needs-you" style={{ marginBottom: 'var(--space-8)' }}>
              <h2 id="needs-you" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                Needs you ({needs.length})
              </h2>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {needs.slice(0, NEEDS_SHOWN).map(p => (
                  <NeedRow key={p.id} project={p} client={brandName.get(p.brandId) ?? ''} token={token} origin={origin} />
                ))}
                {needs.length > NEEDS_SHOWN && (
                  <Link
                    href={`/status/${token}?show=client`}
                    className="sb-need sb-name"
                    style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}
                  >
                    {needs.length - NEEDS_SHOWN} more are waiting on the client. See all {total.client} →
                  </Link>
                )}
              </div>
            </section>
          )}

          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
            {show === 'all' ? 'All clients' : 'Clients'} ({withProjects.length})
          </h2>
          {withProjects.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-6)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>Nothing here right now.</p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {withProjects.map(brand => <ClientBlock key={brand.id} brand={brand} token={token} show={show} />)}
          </div>

          {show === 'all' && empty.length > 0 && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-5)' }}>
              No projects yet: {empty.map(b => b.name).join(', ')}.
            </p>
          )}
        </>
      )}
    </StatusShell>
  )
}

/** One line in "Needs you": the client, the project, and its one action. */
function NeedRow({ project: p, client, token, origin }: { project: BoardProject; client: string; token: string; origin: string }) {
  const line = statusLine(p)
  const files = p.approved.length
  // What the client still has to look at, when we can count it.
  const detail = p.bucket === 'ready'
    ? files > 0 ? plural(files, 'approved file') : null
    : p.tally.awaiting > 0 ? `${plural(p.tally.awaiting, 'file')} not reviewed` : null

  return (
    <div className="sb-need">
      <div style={{ minWidth: 0 }}>
        <Link href={`/status/${token}/${p.brandId}#p-${p.id}`} className="sb-name" style={{ fontSize: 14, fontWeight: 600 }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{client} · </span>
          {p.name}
        </Link>
        <div style={{ fontSize: 'var(--text-sm)', color: TONE[line.tone], marginTop: 3 }}>
          {line.text}{detail && <span style={{ color: 'var(--text-muted)' }}> · {detail}</span>}
        </div>
      </div>
      <div className="sb-actions">
        {p.bucket === 'ready' ? <FileActions project={p} token={token} /> : p.shareToken ? (
          <>
            <CopyText text={`${origin}/review/${p.shareToken}`} label="Copy review link" />
            <a href={`/review/${p.shareToken}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm"
              aria-label={`Open the client review link for ${p.name}`} style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}>
              Open
            </a>
          </>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>No review link yet</span>
        )}
      </div>
    </div>
  )
}

function ClientBlock({ brand, token, show }: { brand: BoardBrand; token: string; show: Show }) {
  const c = countBoard(brand.projects)
  const listed = brand.projects.filter(p => matches(p, show)).sort(byUrgency)
  // Under "All open" the launched work folds away so the open work leads.
  const launched = show === 'all' ? brand.projects.filter(p => p.bucket === 'launched').reverse() : []
  const initials = brand.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const hue = [...brand.name].reduce((n, ch) => n + ch.charCodeAt(0), 0) * 7 % 360
  const summary = [
    c.ready && `${c.ready} ready`,
    c.client && `${c.client} waiting on client`,
    c.team && `${c.team} with our team`,
    c.late && `${c.late} late`,
    c.launched && `${c.launched} launched`,
  ].filter(Boolean).join(' · ')

  return (
    <details open className="card sb-client" style={{ padding: 0, overflow: 'hidden' }}>
      <summary>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 36, height: 36, borderRadius: 9, flexShrink: 0,
            background: `hsl(${hue}, 55%, 30%)`, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
          }}>
            {initials}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {brand.name}
            </span>
            <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 1 }}>
              {summary || 'No projects yet'}
            </span>
          </span>
        </span>
        <ChevronDown size={18} className="sb-chevron" aria-hidden />
      </summary>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        padding: '9px var(--space-6)', borderTop: '1px solid var(--border)', background: 'var(--surface-raised)',
        fontSize: 'var(--text-sm)',
      }}>
        {brand.website ? (
          <a href={brand.website} target="_blank" rel="noopener noreferrer" className="sb-url" aria-label={`${brand.name} website: ${brand.website}`}>
            {shortUrl(brand.website)}
          </a>
        ) : <span />}
        <Link href={`/status/${token}/${brand.id}`} style={{ color: 'var(--text-secondary)', textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 600 }}>
          Open client page →
        </Link>
      </div>

      {listed.map(p => <ProjectRow key={p.id} project={p} token={token} />)}
      {listed.length === 0 && show === 'all' && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0, padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border)' }}>
          Nothing in the works right now.
        </p>
      )}
      {launched.length > 0 && (
        <details className="sb-more">
          <summary>Launched ({launched.length})</summary>
          {launched.map(p => <ProjectRow key={p.id} project={p} token={token} />)}
        </details>
      )}
    </details>
  )
}

function ProjectRow({ project: p, token }: { project: BoardProject; token: string }) {
  const line = statusLine(p)
  const lp = p.lpStage ? normalizeStage(p.lpStage) : null
  const ads = p.creativesStage ? normalizeStage(p.creativesStage) : null
  // A track that has not started says nothing next to one that has: several
  // projects have no ads planned at all, and "not started" would read as late.
  const showLp = lp !== null && !(lp === 'brief' && ads !== null && ads !== 'brief')
  const showAds = ads !== null && !(ads === 'brief' && lp !== null && lp !== 'brief')

  // A div, not one big link: the row holds its own links and a button, and an
  // agent reading the page needs each of them to be a separate, named target.
  return (
    <div className="sb-row">
      <div style={{ minWidth: 0 }}>
        <Link href={`/status/${token}/${p.brandId}#p-${p.id}`} className="sb-name" style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
          {p.name}
        </Link>
        <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: TONE[line.tone], fontWeight: line.tone === 'bad' ? 600 : 500, marginTop: 3 }}>
          {line.text}
        </span>
        {p.lpUrl && (
          <a
            href={p.lpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sb-url"
            title={p.lpUrl}
            aria-label={`Website URL for ${p.name}: ${p.lpUrl}`}
            style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}
          >
            {shortUrl(p.lpUrl)}
          </a>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
        {showLp && lp && <Progress label="Page" stage={lp} />}
        {showAds && ads && <Progress label="Ads" stage={ads} />}
      </div>

      <div className="sb-actions">
        {p.approved.length > 0 ? (
          <FileActions project={p} token={token} />
        ) : p.dueDate && p.bucket !== 'launched' ? (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Due {dueLabel(p.dueDate)}</span>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>No approved files</span>
        )}
      </div>
    </div>
  )
}

/** How far one track is, as a bar with the stage in plain words. */
function Progress({ label, stage }: { label: string; stage: Stage }) {
  const color = stage === 'ready' || stage === 'live' ? 'var(--success)'
    : stage === 'client_review' ? 'var(--stage-client)'
    : 'var(--stage-progress)'
  // A sliver even at zero, so "not started" reads as a bar and not a gap.
  const pct = Math.max(STAGE_PCT[stage], 4)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
      <span style={{ width: 34, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
      <div
        role="progressbar"
        aria-label={`${label}: ${STAGE_PLAIN[stage]}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={STAGE_PCT[stage]}
        style={{ flex: 1, minWidth: 40, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
      </div>
      <span style={{ width: 92, flexShrink: 0 }}>{STAGE_PLAIN[stage]}</span>
    </div>
  )
}

/** Download the approved files, or open the ad kit an AI agent can read. */
function FileActions({ project: p, token }: { project: BoardProject; token: string }) {
  const files = p.approved.length
  if (files === 0) return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>No approved files</span>
  return (
    <>
      <DownloadApproved
        token={token}
        files={p.approved.map(a => ({ id: a.id, name: safeName(a.name, `creative-${a.id.slice(0, 8)}`) }))}
        zipName={safeName(p.name, 'project')}
        label={`Download ${files}`}
        ariaLabel={`Download ${plural(files, 'approved file')} for ${p.name} as a zip`}
      />
      <Link
        href={`/status/${token}/kit/${p.id}`}
        className="btn-secondary btn-sm"
        aria-label={`Ad kit for ${p.name}: website URL and a download link for each approved file`}
        style={{ whiteSpace: 'nowrap', textDecoration: 'none' }}
      >
        Ad kit
      </Link>
    </>
  )
}
