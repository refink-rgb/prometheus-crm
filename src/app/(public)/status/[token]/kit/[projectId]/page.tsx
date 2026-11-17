import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { loadBoardProject, resolveStatusToken } from '@/lib/status/server'
import { buildKit, kitInstructions, KIT_RULES } from '@/lib/status/kit'
import { safeName } from '@/lib/status/board'
import CopyText from '@/components/status/CopyText'
import DownloadApproved from '@/components/status/DownloadApproved'
import { StatusShell } from '@/components/status/StatusShell'

// The ad kit for one project: the website URL and every client-approved file,
// each with a direct download link. Built for whoever uploads the ads, which
// is often an AI agent driving a browser, so:
//   - every fact is plain text on the page, nothing behind a hover or a click
//   - every link is a real <a href> with the full URL written out
//   - files are a real <table>, one row per file
// The same data is at /api/status/<token>/kit?project=<id> as JSON.

export const metadata: Metadata = { title: 'Ad kit', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function AdKitPage({
  params,
}: {
  params: Promise<{ token: string; projectId: string }>
}) {
  const { token, projectId } = await params
  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) notFound()
  const found = await loadBoardProject(service, engineer, projectId)
  if (!found) notFound()

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const origin = `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')}://${host}`
  const kit = buildKit(origin, token, found.brand, found.project)
  const files = kit.approved_files
  const cell: React.CSSProperties = { padding: '9px 12px', borderTop: '1px solid var(--border)', verticalAlign: 'top', fontSize: 'var(--text-sm)' }
  const head: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
  const link: React.CSSProperties = { color: 'var(--accent)', wordBreak: 'break-all' }

  return (
    <StatusShell>
      <Link href={`/status/${token}/${found.brand.id}#p-${found.project.id}`} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← {found.brand.name}
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
            Ad kit · {kit.project}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Everything needed to upload these ads: the website URL and the files the client approved.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {files.length > 0 && (
            <>
              <CopyText text={kitInstructions(kit)} label="Copy instructions for an AI agent" primary />
              <DownloadApproved
                token={token}
                files={found.project.approved.map(a => ({ id: a.id, name: safeName(a.name, `creative-${a.id.slice(0, 8)}`) }))}
                zipName={safeName(kit.project, 'project')}
                label={`Download all ${files.length} (.zip)`}
              />
            </>
          )}
        </div>
      </div>

      <section aria-labelledby="kit-details" className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginTop: 'var(--space-6)' }}>
        <h2 id="kit-details" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Details
        </h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) minmax(0, 1fr)', gap: '10px 16px', margin: 0, fontSize: 14 }}>
          <Term>Client</Term>
          <Desc>{kit.client}</Desc>
          <Term>Client website</Term>
          <Desc>
            {kit.client_website
              ? <a href={kit.client_website} target="_blank" rel="noopener noreferrer" style={link}>{kit.client_website}</a>
              : 'Not set'}
          </Desc>
          <Term>Project</Term>
          <Desc>{kit.project}</Desc>
          <Term>Status</Term>
          <Desc>{kit.status}. {kit.waiting_on}.</Desc>
          <Term>Website URL for the ads</Term>
          <Desc>
            {kit.website_url ? (
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <a id="website-url" href={kit.website_url} target="_blank" rel="noopener noreferrer" style={{ ...link, fontWeight: 600 }}>
                  {kit.website_url}
                </a>
                <CopyText text={kit.website_url} label="Copy URL" />
              </span>
            ) : (
              <strong style={{ color: 'var(--danger)' }}>Not set yet. Ask the team before uploading.</strong>
            )}
          </Desc>
        </dl>
      </section>

      <section aria-labelledby="kit-files" className="card" style={{ padding: 0, marginTop: 'var(--space-5)', overflow: 'hidden' }}>
        <h2 id="kit-files" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', padding: 'var(--space-5) var(--space-6) var(--space-3)' }}>
          Approved files ({files.length})
        </h2>
        {files.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '0 var(--space-6) var(--space-5)' }}>
            The client has not approved any files on this project yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ background: 'var(--surface-raised)' }}>
                  <th scope="col" style={{ ...head, width: 44 }}>#</th>
                  <th scope="col" style={head}>File name</th>
                  <th scope="col" style={{ ...head, width: 70 }}>Type</th>
                  <th scope="col" style={head}>Download link</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.download_url}>
                    <td style={{ ...cell, color: 'var(--text-muted)' }}>{f.position}</td>
                    <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 600, wordBreak: 'break-word' }}>{f.file_name}</td>
                    <td style={{ ...cell, color: 'var(--text-secondary)' }}>{f.media_type === 'video' ? 'Video' : 'Image'}</td>
                    <td style={cell}>
                      <a href={f.download_url} download style={link}>{f.download_url}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="kit-rules" className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginTop: 'var(--space-5)' }}>
        <h2 id="kit-rules" style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
          How to use this page
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {KIT_RULES.map(rule => <li key={rule}>{rule}</li>)}
        </ul>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '12px 0 0' }}>
          The same information as data (JSON): <a href={kit.kit_json_url} style={link}>{kit.kit_json_url}</a>
        </p>
      </section>
    </StatusShell>
  )
}

function Term({ children }: { children: React.ReactNode }) {
  return <dt style={{ color: 'var(--text-muted)' }}>{children}</dt>
}
function Desc({ children }: { children: React.ReactNode }) {
  return <dd style={{ margin: 0, color: 'var(--text-primary)', minWidth: 0 }}>{children}</dd>
}
