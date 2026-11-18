import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadPods } from '@/lib/v2/pods-server'
import { loadWorkList } from '@/lib/v2/work-server'
import { deliverableLabel, isUuid, workStatusLabel } from '@/lib/v2/model'
import { formatDay } from '@/lib/v2/templates'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ show?: string; pod?: string }> }) {
  const sp = await searchParams
  const show = sp.show === 'finished' ? 'finished' : 'open'
  const podId = isUuid(sp.pod) ? sp.pod : null
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  const supabase = await createClient()
  const [work, pods] = await Promise.all([loadWorkList(supabase, show, podId), loadPods(supabase)])

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / Work</div>
  if (!work || pods.missing) return <div className={styles.page}>{crumbs}<h1 className={styles.h1}>Work</h1><MissingTables /></div>

  const href = (next: { show?: string; pod?: string | null }) => {
    const q = new URLSearchParams()
    const s = next.show ?? show, p = next.pod === undefined ? podId : next.pod
    if (s === 'finished') q.set('show', 'finished')
    if (p) q.set('pod', p)
    const qs = q.toString()
    return `/v2/work${qs ? `?${qs}` : ''}`
  }

  return (
    <div className={styles.page}>
      {crumbs}
      <div className={styles.spread}>
        <h1 className={styles.h1}>Work</h1>
        <Link href="/v2/work/new" className="btn-primary">New work</Link>
      </div>

      <nav className={styles.inline} aria-label="Filter work">
        <Link href={href({ show: 'open' })} className={`${styles.pill} ${show === 'open' ? styles.pillOn : ''}`} aria-current={show === 'open' ? 'page' : undefined}>Open</Link>
        <Link href={href({ show: 'finished' })} className={`${styles.pill} ${show === 'finished' ? styles.pillOn : ''}`} aria-current={show === 'finished' ? 'page' : undefined}>Finished</Link>
        <span className={styles.muted}>·</span>
        <Link href={href({ pod: null })} className={`${styles.pill} ${!podId ? styles.pillOn : ''}`}>All pods</Link>
        {pods.pods.map(p => (
          <Link key={p.id} href={href({ pod: p.id })} className={`${styles.pill} ${podId === p.id ? styles.pillOn : ''}`}>{p.name}</Link>
        ))}
      </nav>

      {work.length === 0 ? (
        <div className="card">
          <p className={styles.muted}>
            {show === 'open' ? <>No open work{podId ? ' for this pod' : ''}. <Link href="/v2/work/new">Create some</Link>.</> : 'Nothing finished yet.'}
          </p>
        </div>
      ) : (
        <div className={`card ${styles.workTable}`} role="table" aria-label="Work">
          <div className={styles.workHead} role="row">
            <span role="columnheader">Work</span>
            <span role="columnheader">Launch</span>
            <span role="columnheader">Progress</span>
            <span role="columnheader">Next</span>
          </div>
          {work.map(w => (
            <Link key={w.id} href={`/v2/work/${w.id}`} className={styles.workRow} role="row">
              <span role="cell" className={styles.stackTight}>
                <b>{w.name}</b>
                <span className={styles.muted}>
                  {w.brand} · {w.service_line}{w.pod ? ` · ${w.pod}` : ' · No pod'}
                  {w.status !== 'active' ? ` · ${workStatusLabel(w.status)}` : ''}
                </span>
                <span className={styles.inline}>{w.kinds.map((k, i) => <span key={i} className={styles.tag}>{deliverableLabel(k)}</span>)}</span>
              </span>
              <span role="cell">{formatDay(w.launch_date)}</span>
              <span role="cell" className={styles.stackTight}>
                <span>{w.done} of {w.total} done</span>
                <span className={styles.bar} aria-hidden><span style={{ width: `${w.total ? Math.round((w.done / w.total) * 100) : 0}%` }} /></span>
                {w.overdue > 0 && <span className={styles.warn}>{w.overdue} overdue</span>}
              </span>
              <span role="cell" className={styles.stackTight}>
                {w.next ? (
                  <>
                    <span>{w.next.title}</span>
                    <span className={styles.muted}>{formatDay(w.next.due_date)} · {w.next.owner ?? 'Nobody yet'}</span>
                  </>
                ) : <span className={styles.muted}>All tasks closed</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
