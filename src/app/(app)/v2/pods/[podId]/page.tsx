import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadPods } from '@/lib/v2/pods-server'
import { POD_ROLES } from '@/lib/v2/model'
import {
  AddClientForm, AddMemberForm, ArchivePodButton, ClientPodSelect, RemoveMemberButton, RenamePodForm,
} from '@/components/v2/PodControls'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function PodPage({ params }: { params: Promise<{ podId: string }> }) {
  const { podId } = await params
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  const supabase = await createClient()
  const data = await loadPods(supabase)

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / <Link href="/v2/pods">Pods</Link></div>
  if (data.missing) return <div className={styles.page}>{crumbs}<MissingTables /></div>

  const pod = data.pods.find(p => p.id === podId)
  if (!pod) notFound()

  const podOptions = data.pods.map(p => ({ id: p.id, name: p.name }))
  const podName = (id: string | null) => data.pods.find(p => p.id === id)?.name ?? null
  const addable = data.clients
    .filter(c => c.is_active && c.pod_id !== pod.id)
    .map(c => ({ id: c.id, name: c.name, podName: podName(c.pod_id) }))
  const lead = pod.members.find(m => m.role === 'account_manager')

  return (
    <div className={styles.page}>
      {crumbs}
      <div className={styles.spread}>
        <RenamePodForm podId={pod.id} name={pod.name} />
        <ArchivePodButton podId={pod.id} name={pod.name} clientCount={pod.clients.length} />
      </div>
      <p className={styles.sub}>
        {lead ? <>Led by <b>{lead.name}</b>. </> : <span className={styles.warn}>No account manager yet. </span>}
        {pod.clients.length} client{pod.clients.length === 1 ? '' : 's'}.
      </p>

      <div className={styles.grid3}>
        {POD_ROLES.map(r => {
          const members = pod.members.filter(m => m.role === r.id)
          const taken = new Set(members.map(m => m.profile_id))
          const people = data.people.filter(p => !taken.has(p.id))
          return (
            <section key={r.id} className={`card ${styles.panel}`} aria-labelledby={`role-${r.id}`}>
              <div>
                <h2 id={`role-${r.id}`} className={styles.h2}>{r.plural}</h2>
                <p className={styles.muted}>{r.hint}</p>
              </div>
              {members.length > 0 && (
                <div className={styles.list}>
                  {members.map(m => (
                    <div key={m.profile_id} className={styles.row}>
                      <span>{m.name}</span>
                      <RemoveMemberButton podId={pod.id} profileId={m.profile_id} role={m.role} name={m.name} />
                    </div>
                  ))}
                </div>
              )}
              <AddMemberForm
                podId={pod.id}
                role={r.id}
                people={people}
                disabledReason={r.id === 'account_manager' && members.length > 0 ? 'A pod has one account manager. Remove them to choose someone else.' : undefined}
              />
            </section>
          )
        })}
      </div>

      <section className={`card ${styles.panel}`} aria-labelledby="clients-h">
        <div className={styles.spread}>
          <h2 id="clients-h" className={styles.h2}>Clients · {pod.clients.length}</h2>
          <AddClientForm podId={pod.id} podName={pod.name} clients={addable} />
        </div>
        {pod.clients.length === 0 ? <p className={styles.muted}>No clients yet. Add one above.</p> : (
          <div className={styles.list}>
            {pod.clients.map(c => (
              <div key={c.id} className={styles.row}>
                <span className={styles.inline}><Link href={`/brands/${c.id}`}>{c.name}</Link>{!c.is_active && <span className={styles.muted}>Inactive</span>}</span>
                <span className={styles.inline}>
                  {c.is_active && <Link href={`/v2/work/new?client=${c.id}`} className="btn-secondary btn-sm">New work</Link>}
                  <ClientPodSelect brandId={c.id} brandName={c.name} podId={pod.id} pods={podOptions} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
