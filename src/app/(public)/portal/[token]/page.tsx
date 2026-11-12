import { randomBytes } from 'node:crypto'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import ThemeToggle from '@/components/ThemeToggle'
import { createServiceClient } from '@/lib/supabase/service'
import { intakeCompleteness, intakeSections, normalizeIntake, LINKABLE } from '@/lib/brands/intake'
import { showCheckIn, type CheckIn } from '@/lib/brands/checkin'
import '@/components/intake/intake.css'

// The client's one page: where we are, what needs them, their projects, what
// we have on file, and their feedback. No account: the brand's client_token in
// the URL is the key, and every read below is scoped to that one brand.
//
// Never shown here: internal due dates, the team's satisfaction score,
// internal notes. A project shows a date only when the team set promised_date.
// Until the team marks the page checked (portal_ready_at), projects are held
// back so stale plans never reach the client.

export const metadata: Metadata = { title: 'Client portal', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const STAGE_WORDS: Record<string, string> = {
  brief: 'Getting started',
  in_progress: 'In progress',
  internal_review: 'Being checked by our team',
  client_review: 'Ready for your review',
  revisions: 'Making your changes',
  ready: 'Ready to go live',
  live: 'Live',
}
// The database may gain stages before this page knows them: show the raw word.
const stageWord = (s: string | null) => (s ? STAGE_WORDS[s] ?? s.replace(/_/g, ' ') : null)
const NEXT: Record<string, string> = {
  brief: 'We start the work',
  in_progress: 'Our team checks it before you see it',
  internal_review: 'It comes to you for review',
  client_review: 'Your feedback, then we make changes',
  revisions: 'It comes back to you with your changes',
  ready: 'We set it live',
}

type Proj = { id: string; name: string; is_complete: boolean; lp_stage: string | null; creatives_stage: string | null; share_token: string | null; promised_date: string | null }
type Comment = { id: string; project_id: string; content: string; created_at: string }

const day = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
const promised = (d: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00'))

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length > 100) notFound()
  const db = createServiceClient()
  const { data: brand } = await db
    .from('brands')
    .select('id, name, intake_token, intake_form, intake_submitted_at, ai_sensitivity, brand_guidelines, portal_ready_at, checkin_requested_at')
    .eq('client_token', token)
    .maybeSingle()
  if (!brand) notFound()

  // The intake and check-in live on the brand's intake token. Make one the
  // first time the portal opens, so the client never needs a second link.
  let intakeToken = brand.intake_token as string | null
  if (!intakeToken) {
    intakeToken = randomBytes(24).toString('base64url')
    const { error } = await db.from('brands').update({ intake_token: intakeToken }).eq('id', brand.id).is('intake_token', null)
    if (error) intakeToken = null
  }

  const [{ data: projRows }, { data: docRows }, { data: linkRows }, { data: contactRows }, { data: dna }, { data: checkRows }, { count: offersWaiting }] = await Promise.all([
    db.from('projects').select('id, name, is_complete, lp_stage, creatives_stage, share_token, promised_date').eq('brand_id', brand.id).order('created_at', { ascending: false }),
    db.from('brand_documents').select('file_name, kind, created_at').eq('brand_id', brand.id).order('created_at', { ascending: false }),
    db.from('brand_asset_links').select('covers').eq('brand_id', brand.id),
    db.from('brand_contacts').select('id').eq('brand_id', brand.id),
    db.from('brand_dna').select('primary_font, primary_color').eq('brand_id', brand.id).eq('is_active', true).maybeSingle(),
    db.from('client_checkins').select('*').eq('brand_id', brand.id).order('created_at', { ascending: false }).limit(1),
    db.from('offer_cards').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id).eq('stage', 'client_review'),
  ])
  const projects = (projRows ?? []) as Proj[]
  const docs = (docRows ?? []) as Array<{ file_name: string; kind: string | null; created_at: string }>
  const form = brand.intake_form ? normalizeIntake(brand.intake_form) : null
  const items = intakeCompleteness({
    form,
    docKinds: docs.map(d => d.kind ?? 'other'),
    hasGuidelineText: !!(brand.brand_guidelines as string | null)?.trim(),
    aiSensitivity: (brand.ai_sensitivity as number | null) ?? null,
    contactCount: (contactRows ?? []).length,
    dna: dna as { primary_font?: string | null; primary_color?: string | null } | null,
    linkedKinds: ((linkRows ?? []) as Array<{ covers: string[] | null }>).flatMap(r => r.covers ?? []),
  })
  const missing = items.filter(i => !i.done)
  const latestCheck = ((checkRows ?? []) as CheckIn[])[0] ?? null
  const checkInOpen = !!intakeToken && showCheckIn(latestCheck, (brand.checkin_requested_at as string | null) ?? null)

  const ready = !!brand.portal_ready_at
  const active = projects.filter(p => !p.is_complete)
  const delivered = projects.filter(p => p.is_complete)
  const reviews = active.filter(p => p.share_token && (p.lp_stage === 'client_review' || p.creatives_stage === 'client_review'))

  // Their own words: comments written on review pages (no team author).
  const ids = projects.map(p => p.id)
  const { data: commentRows } = ids.length
    ? await db.from('project_comments').select('id, project_id, content, created_at')
      .in('project_id', ids).is('author_id', null).neq('audience', 'internal') // same filter as the review page
      .order('created_at', { ascending: false }).limit(30)
    : { data: [] }
  const comments = (commentRows ?? []) as Comment[]
  const byProject = new Map<string, Comment[]>()
  for (const c of comments) byProject.set(c.project_id, [...(byProject.get(c.project_id) ?? []), c])

  const intakeUrl = intakeToken ? `/intake/${intakeToken}` : null
  const needs: Array<{ title: string; text: string; href: string; cta: string }> = []
  if (ready) for (const p of reviews) needs.push({ title: `Review: ${p.name}`, text: 'Ready for your feedback.', href: `/review/${p.share_token}`, cta: 'Review' })
  if ((offersWaiting ?? 0) > 0) needs.push({ title: `${offersWaiting} offer${offersWaiting === 1 ? '' : 's'} to approve`, text: 'Have a look and approve, or tell us what to change.', href: `/offer-approval/${token}`, cta: 'See offers' })
  if (missing.length && intakeUrl) needs.push({ title: 'A few things we still need', text: missing.map(i => i.label).join(', ') + '.', href: intakeUrl, cta: 'Add them' })
  if (checkInOpen) needs.push({ title: 'Quick check-in', text: 'Four questions, about two minutes. Tell us how it’s going.', href: `/intake/${intakeToken}/check-in`, cta: 'Start' })

  const sections = form ? intakeSections(form).map(s => ({ ...s, items: s.items.filter(x => x.a) })).filter(s => s.items.length) : []
  const fileKinds = LINKABLE.map(l => ({ ...l, item: items.find(i => i.key === l.k) }))

  return (
    <div className="ik-page">
      <header className="ik-top">
        <div className="ik-top-inner">
          <span className="ik-brand">{brand.name as string}</span>
          <ThemeToggle />
        </div>
      </header>
      <main className="ik-main">
        <section className="ik-intro">
          <h1>Your page with Marketing Moments</h1>
          <p>Everything we&apos;re working on with you, what we need from you, and what we have on file. Keep this link: it stays the same.</p>
        </section>

        {/* 1. Where we are */}
        <section className="ik-card">
          <h2>Where we are</h2>
          {ready ? (
            <p className="ik-help" style={{ margin: 0 }}>
              {delivered.length} delivered · {active.length} in progress
              {reviews.length > 0 && <> · <b>{reviews.length} waiting on your review</b></>}
            </p>
          ) : (
            <p className="ik-help" style={{ margin: 0 }}>We&apos;re putting your project plan together. Your projects and dates will show here soon.</p>
          )}
        </section>

        {/* 2. Needs you */}
        {needs.length > 0 && (
          <section className="ik-card pt-needs">
            <h2>Needs you <span className="ik-badge">{needs.length}</span></h2>
            <ul className="pt-list">
              {needs.map(n => (
                <li key={n.title}>
                  <div><b>{n.title}</b><span>{n.text}</span></div>
                  <a className="pt-cta" href={n.href}>{n.cta}</a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 3. Projects */}
        {ready && (
          <section className="ik-card">
            <h2>Your projects</h2>
            {active.length === 0 && <p className="ik-help" style={{ margin: 0 }}>Nothing in progress right now.</p>}
            <ul className="pt-list">
              {active.map(p => {
                const waiting = p.lp_stage === 'client_review' || p.creatives_stage === 'client_review'
                const lead = [p.lp_stage, p.creatives_stage].find(s => s && s !== 'live') ?? p.lp_stage
                return (
                  <li key={p.id}>
                    <div>
                      <b>{p.name}</b>
                      <span>
                        {[p.lp_stage && `Landing page: ${stageWord(p.lp_stage)}`, p.creatives_stage && `Ads: ${stageWord(p.creatives_stage)}`].filter(Boolean).join(' · ')}
                      </span>
                      <span className="pt-meta">
                        {waiting ? <em className="pt-you">Waiting on you</em> : lead && NEXT[lead] ? `Next: ${NEXT[lead]}` : null}
                        {p.promised_date && <> · Due {promised(p.promised_date)}</>}
                      </span>
                    </div>
                    {p.share_token && <a className="pt-cta pt-cta-quiet" href={`/review/${p.share_token}`}>Open</a>}
                  </li>
                )
              })}
            </ul>
            {delivered.length > 0 && (
              <details className="pt-done">
                <summary>Delivered ({delivered.length})</summary>
                <ul className="pt-list">
                  {delivered.map(p => (
                    <li key={p.id}><div><b>{p.name}</b></div>{p.share_token && <a className="pt-cta pt-cta-quiet" href={`/review/${p.share_token}`}>Open</a>}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {/* 4. On file */}
        <section className="ik-card">
          <h2>What we have on file</h2>
          <ul className="pt-files">
            {fileKinds.map(f => (
              <li key={f.k} className={f.item?.done ? 'ok' : 'miss'}>
                <span aria-hidden>{f.item?.done ? '✓' : '○'}</span>
                <b>{f.label}</b>
                <em>{f.item?.done ? (f.item.linked ? 'From the link you shared' : f.item.note ?? 'We have it') : 'Still needed'}</em>
              </li>
            ))}
          </ul>
          {sections.length > 0 ? (
            <details className="pt-done">
              <summary>Your intake answers{brand.intake_submitted_at ? ` (sent ${day(brand.intake_submitted_at as string)})` : ''}</summary>
              {sections.map(s => (
                <div key={s.title} className="pt-answers">
                  <p className="pt-label">{s.title}</p>
                  <dl>{s.items.map(x => <div key={x.q}><dt>{x.q}</dt><dd>{x.a}</dd></div>)}</dl>
                </div>
              ))}
            </details>
          ) : (
            <p className="ik-help" style={{ margin: 0 }}>You haven&apos;t filled in the intake yet.</p>
          )}
          {intakeUrl && <a className="ik-btn-secondary" href={intakeUrl}>{sections.length ? 'Update your answers or files' : 'Fill in the intake'}</a>}
        </section>

        {/* 5. Their feedback */}
        {comments.length > 0 && (
          <section className="ik-card">
            <h2>Your feedback</h2>
            <p className="ik-help">What you&apos;ve told us on each project. Want to add to it? Open the project and leave another note.</p>
            {[...byProject.entries()].map(([pid, cs]) => {
              const p = projects.find(x => x.id === pid)
              return (
                <div key={pid} className="pt-answers">
                  <p className="pt-label">{p?.name ?? 'Project'}</p>
                  <ul className="pt-quotes">
                    {cs.slice(0, 5).map(c => <li key={c.id}><q>{c.content.length > 280 ? c.content.slice(0, 280) + '…' : c.content}</q><small>{day(c.created_at)}</small></li>)}
                  </ul>
                  {p?.share_token && <a className="ik-link" href={`/review/${p.share_token}`}>Add more →</a>}
                </div>
              )
            })}
          </section>
        )}
      </main>
    </div>
  )
}
