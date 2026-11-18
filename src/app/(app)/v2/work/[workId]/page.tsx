import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadPods } from '@/lib/v2/pods-server'
import { loadPeople, loadWork, todayIso, type TaskRow } from '@/lib/v2/work-server'
import { isClosedTask, isUuid, roleLabel } from '@/lib/v2/model'
import { formatDay } from '@/lib/v2/templates'
import { TaskDueInput, TaskOwnerSelect, TaskStatusSelect, WorkStatusSelect } from '@/components/v2/WorkControls'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function WorkDetailPage({ params }: { params: Promise<{ workId: string }> }) {
  const { workId } = await params
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  if (!isUuid(workId)) notFound()
  const supabase = await createClient()
  const [res, pods, people] = await Promise.all([loadWork(supabase, workId), loadPods(supabase), loadPeople()])

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / <Link href="/v2/work">Work</Link></div>
  if (res.missing) return <div className={styles.page}>{crumbs}<MissingTables /></div>
  if (!res.detail) notFound()
  const { work, brand, pod, deliverables, tasks } = res.detail

  const podMembers = !pods.missing && pod ? pods.pods.find(p => p.id === pod.id)?.members ?? [] : []
  const podPeople = (role: string | null) => {
    const seen = new Set<string>()
    return podMembers
      .filter(m => (role ? m.role === role : true))
      .filter(m => (seen.has(m.profile_id) ? false : (seen.add(m.profile_id), true)))
      .map(m => ({ id: m.profile_id, name: m.name }))
  }
  const owner = people.find(p => p.id === work.owner_id)?.name ?? null
  const today = todayIso()
  const done = tasks.filter(t => isClosedTask(t.status)).length

  const sections = [
    { id: null as string | null, label: 'Whole piece of work' },
    ...deliverables.map(d => ({ id: d.id, label: d.label })),
  ]

  const row = (t: TaskRow) => {
    const late = !!t.due_date && t.due_date < today && !isClosedTask(t.status)
    return (
      <div key={t.id} className={`${styles.workTask} ${t.parent_id ? styles.subRow : ''}`} role="row">
        <span role="cell" className={styles.stackTight}>
          <span className={isClosedTask(t.status) ? styles.closed : undefined}>{t.title}</span>
          {t.role && <span className={styles.muted}>{roleLabel(t.role)}</span>}
        </span>
        <span role="cell"><TaskOwnerSelect taskId={t.id} ownerId={t.owner_id} title={t.title} people={people} podPeople={podPeople(t.role)} /></span>
        <span role="cell"><TaskDueInput taskId={t.id} due={t.due_date} title={t.title} late={late} /></span>
        <span role="cell"><TaskStatusSelect taskId={t.id} status={t.status} title={t.title} /></span>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {crumbs}
      <div className={styles.spread}>
        <div className={styles.head}>
          <h1 className={styles.h1}>{work.name}</h1>
          <p className={styles.sub}>
            <Link href={`/brands/${brand.id}`}>{brand.name}</Link> · {work.service_line} · Launch {formatDay(work.launch_date)}
            {' · '}{pod ? <Link href={`/v2/pods/${pod.id}`}>{pod.name}</Link> : 'No pod'}
            {owner ? ` · Led by ${owner}` : ''}
          </p>
        </div>
        <WorkStatusSelect workId={work.id} status={work.status} />
      </div>

      <div className={styles.inline}>
        <span>{done} of {tasks.length} tasks done</span>
        <span className={styles.bar} style={{ width: 200 }} aria-hidden><span style={{ width: `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%` }} /></span>
      </div>

      {sections.map(s => {
        const top = tasks.filter(t => t.deliverable_id === s.id && t.parent_id === null)
        if (!top.length) return null
        return (
          <section key={s.id ?? 'general'} className={`card ${styles.panel}`} aria-label={s.label}>
            <h2 className={styles.h2}>{s.label}</h2>
            <div className={styles.taskTable} role="table" aria-label={`${s.label} tasks`}>
              <div className={`${styles.workTask} ${styles.taskHead}`} role="row">
                <span role="columnheader">Task</span>
                <span role="columnheader">Who</span>
                <span role="columnheader">Due</span>
                <span role="columnheader">Status</span>
              </div>
              {top.flatMap(t => [row(t), ...tasks.filter(c => c.parent_id === t.id).map(row)])}
            </div>
          </section>
        )
      })}

      <p className={styles.muted}>Brief, files, reviews and comments for each deliverable come with the next part of 2.0.</p>
    </div>
  )
}
