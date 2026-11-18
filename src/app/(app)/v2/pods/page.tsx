import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadPods } from '@/lib/v2/pods-server'
import { POD_ROLES } from '@/lib/v2/model'
import { ClientPodSelect, CreatePodForm } from '@/components/v2/PodControls'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function PodsPage() {
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  const supabase = await createClient()
  const data = await loadPods(supabase)

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / Pods</div>
  if (data.missing) {
    return <div className={styles.page}>{crumbs}<h1 className={styles.h1}>Pods</h1><MissingTables /></div>
  }

  const activePodIds = new Set(data.pods.map(p => p.id))
  // A client whose pod was archived counts as having none.
  const unassigned = data.clients.filter(c => c.is_active && (!c.pod_id || !activePodIds.has(c.pod_id)))
  const podOptions = data.pods.map(p => ({ id: p.id, name: p.name }))
  const inAPod = new Set(data.pods.flatMap(p => p.members.map(m => m.profile_id)))
  const outside = data.people.filter(p => !inAPod.has(p.id))

  return (
    <div className={styles.page}>
      {crumbs}
      <div className={styles.head}>
        <h1 className={styles.h1}>Pods</h1>
        <p className={styles.sub}>A pod is the team that looks after a set of clients: one account manager who leads it, plus designers and landing page builders. When work is created for a client, its tasks go to that client&apos;s pod.</p>
      </div>

      <CreatePodForm />

      {data.pods.length === 0 ? (
        <div className="card"><p className={styles.muted}>No pods yet. Create the first one above, then add its people and clients.</p></div>
      ) : (
        <div className={styles.grid}>
          {data.pods.map(pod => {
            const lead = pod.members.find(m => m.role === 'account_manager')
            return (
              <Link key={pod.id} href={`/v2/pods/${pod.id}`} className={`card ${styles.podCard}`}>
                <span className={styles.podName}>{pod.name}</span>
                <div className={styles.field}>
                  {POD_ROLES.map(r => {
                    const people = pod.members.filter(m => m.role === r.id)
                    return (
                      <span key={r.id} style={{ display: 'contents' }}>
                        <span>{r.plural}</span>
                        <div className={r.id === 'account_manager' && !lead ? styles.warn : undefined}>
                          {people.length ? people.map(m => m.name).join(', ') : r.id === 'account_manager' ? 'No lead yet' : 'None'}
                        </div>
                      </span>
                    )
                  })}
                  <span>Clients</span><div>{pod.clients.length}</div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <section className={`card ${styles.panel}`} aria-labelledby="unassigned-h">
        <div className={styles.spread}>
          <h2 id="unassigned-h" className={styles.h2}>Clients without a pod · {unassigned.length}</h2>
          {data.pods.length === 0 && <span className={styles.muted}>Create a pod to start assigning clients.</span>}
        </div>
        {unassigned.length === 0 ? <p className={styles.muted}>Every active client is in a pod.</p> : (
          <div className={styles.list}>
            {unassigned.map(c => (
              <div key={c.id} className={styles.row}>
                <Link href={`/brands/${c.id}`}>{c.name}</Link>
                {data.pods.length > 0 && <ClientPodSelect brandId={c.id} brandName={c.name} podId={null} pods={podOptions} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.pods.length > 0 && (
        <section className={`card ${styles.panel}`} aria-labelledby="outside-h">
          <h2 id="outside-h" className={styles.h2}>People not in a pod · {outside.length}</h2>
          <p className={styles.muted}>Everyone with access to Prometheus who isn&apos;t in any pod yet. Add them from a pod&apos;s page.</p>
          {outside.length > 0 && <p className={styles.sub}>{outside.map(p => p.name).join(' · ')}</p>}
        </section>
      )}
    </div>
  )
}
