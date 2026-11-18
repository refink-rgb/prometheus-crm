import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadPods } from '@/lib/v2/pods-server'
import { loadTemplates, loadWorkList } from '@/lib/v2/work-server'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

// Prometheus 2.0 home. Grows a section per phase as each one ships; until then
// the build order is listed in plain text, never as links to empty screens.
export default async function V2Home() {
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  const supabase = await createClient()
  const [data, templates, work] = await Promise.all([loadPods(supabase), loadTemplates(supabase), loadWorkList(supabase, 'open')])
  const overdue = work?.reduce((n, w) => n + w.overdue, 0) ?? 0
  const unowned = work?.filter(w => w.next && !w.next.owner).length ?? 0

  const activePodIds = data.missing ? new Set<string>() : new Set(data.pods.map(p => p.id))
  const unassigned = data.missing ? [] : data.clients.filter(c => c.is_active && (!c.pod_id || !activePodIds.has(c.pod_id)))
  const podsWithoutLead = data.missing ? [] : data.pods.filter(p => !p.members.some(m => m.role === 'account_manager'))

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.titleRow}><h1 className={styles.h1}>Prometheus 2.0</h1><span className={styles.tag}>In progress</span></div>
        <p className={styles.sub}>One way of running every kind of work: tests, BFCM and Evergreen. Each piece of work is made of deliverables (landing page, creatives, or both), with tasks owned by the pod that looks after the client.</p>
      </div>

      {data.missing || !templates || !work ? <MissingTables /> : (
        <div className={styles.grid}>
          <Link href="/v2/work" className={`card ${styles.podCard}`}>
            <div className={styles.spread}><span className={styles.podName}>Work</span><span className={styles.muted}>Every open piece of work →</span></div>
            <div className={styles.field}>
              <span>Open</span><div>{work.length || 'None yet'}</div>
              <span>Overdue tasks</span><div className={overdue ? styles.warn : undefined}>{overdue || 'None'}</div>
              <span>Next step unowned</span><div className={unowned ? styles.warn : undefined}>{unowned || 'None'}</div>
            </div>
          </Link>
          <Link href="/v2/templates" className={`card ${styles.podCard}`}>
            <div className={styles.spread}><span className={styles.podName}>Templates</span><span className={styles.muted}>How each kind of work runs →</span></div>
            <div className={styles.field}>
              <span>Templates</span><div>{templates.length ? templates.map(t => t.name).join(', ') : 'None yet'}</div>
            </div>
          </Link>
          <Link href="/v2/pods" className={`card ${styles.podCard}`}>
            <div className={styles.spread}><span className={styles.podName}>Pods</span><span className={styles.muted}>Teams and their clients →</span></div>
            <div className={styles.field}>
              <span>Pods</span><div>{data.pods.length || 'None yet'}</div>
              <span>Without a lead</span><div className={podsWithoutLead.length ? styles.warn : undefined}>{podsWithoutLead.length ? podsWithoutLead.map(p => p.name).join(', ') : 'None'}</div>
              <span>Clients without a pod</span><div className={unassigned.length ? styles.warn : undefined}>{unassigned.length} of {data.clients.filter(c => c.is_active).length} active</div>
            </div>
          </Link>
        </div>
      )}

      <section className={`card ${styles.panel}`} aria-label="Build order">
        <h2 className={styles.h2}>What&apos;s coming, in order</h2>
        <div className={styles.next}>
          <div className={styles.nextItem}><span className={`${styles.phase} ${styles.done}`}>Built</span><div><b>Pods.</b> Teams of an account manager (the lead), designers and landing page builders, and the clients each one looks after.</div></div>
          <div className={styles.nextItem}><span className={`${styles.phase} ${styles.done}`}>Built</span><div><b>Templates and work.</b> Set up each service line once. Create work for a client, choose landing page, creatives or both, set a launch date, and every task arrives dated and assigned from the pod.</div></div>
          <div className={styles.nextItem}><span className={styles.phase}>Next</span><div><b>The full work page.</b> Brief, one tab per deliverable, tasks and subtasks on a timeline, comments and history.</div></div>
          <div className={styles.nextItem}><span className={styles.phase}>Then</span><div><b>Files and reviews.</b> One way to sync from Drive, review internally and with the client, for every deliverable.</div></div>
          <div className={styles.nextItem}><span className={styles.phase}>Then</span><div><b>Home and capacity.</b> Everyone&apos;s tasks, mentions and calls in one place; workload by pod and person across all work.</div></div>
          <div className={styles.nextItem}><span className={styles.phase}>Then</span><div><b>One client portal.</b> Every piece of work and every review for a client on one link.</div></div>
        </div>
      </section>
    </div>
  )
}
