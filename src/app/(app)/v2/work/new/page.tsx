import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadPods } from '@/lib/v2/pods-server'
import { loadTemplates } from '@/lib/v2/work-server'
import { isUuid } from '@/lib/v2/model'
import NewWorkForm from '@/components/v2/NewWorkForm'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function NewWorkPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  const supabase = await createClient()
  const [pods, templates] = await Promise.all([loadPods(supabase), loadTemplates(supabase)])

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / <Link href="/v2/work">Work</Link> / New</div>
  if (pods.missing || !templates) {
    return <div className={styles.page}>{crumbs}<h1 className={styles.h1}>New work</h1><MissingTables /></div>
  }

  const activePods = new Set(pods.pods.map(p => p.id))
  return (
    <div className={styles.page}>
      {crumbs}
      <div className={styles.head}>
        <h1 className={styles.h1}>New work</h1>
        <p className={styles.sub}>Pick the client and the kind of work, choose what it delivers and when it launches. Every task is dated back from launch and given to the client&apos;s pod. Check the plan below, then create it.</p>
      </div>
      {templates.length === 0 ? (
        <div className="card"><p className={styles.muted}>There are no templates yet. <Link href="/v2/templates">Set one up first</Link>.</p></div>
      ) : (
        <NewWorkForm
          initialClientId={isUuid(client) ? client : ''}
          clients={pods.clients.filter(c => c.is_active).map(c => ({ id: c.id, name: c.name, podId: c.pod_id && activePods.has(c.pod_id) ? c.pod_id : null }))}
          pods={pods.pods.map(p => ({ id: p.id, name: p.name, members: p.members.map(m => ({ id: m.profile_id, name: m.name, role: m.role })) }))}
          people={pods.people}
          templates={templates}
        />
      )}
    </div>
  )
}
