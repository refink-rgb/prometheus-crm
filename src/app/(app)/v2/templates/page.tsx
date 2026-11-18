import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { loadTemplates } from '@/lib/v2/work-server'
import { deliverableLabel } from '@/lib/v2/model'
import { CreateTemplateForm } from '@/components/v2/TemplateEditor'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function TemplatesPage() {
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  const supabase = await createClient()
  const templates = await loadTemplates(supabase)

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / Templates</div>
  if (!templates) return <div className={styles.page}>{crumbs}<h1 className={styles.h1}>Templates</h1><MissingTables /></div>

  return (
    <div className={styles.page}>
      {crumbs}
      <div className={styles.head}>
        <h1 className={styles.h1}>Templates</h1>
        <p className={styles.sub}>A template is one kind of work, set up once: what it delivers and the tasks that get it done, each with who does it and how many days before launch. Creating work copies the template, so changing a template never changes work already running.</p>
      </div>

      <CreateTemplateForm templates={templates.map(t => ({ id: t.id, name: t.name }))} />

      {templates.length === 0 ? (
        <div className="card"><p className={styles.muted}>No templates yet. Create one above.</p></div>
      ) : (
        <div className={styles.grid}>
          {templates.map(t => {
            const top = t.tasks.filter(x => x.parent === null).length
            const subs = t.tasks.length - top
            const days = t.tasks.map(x => x.days_before_launch).filter((d): d is number => d !== null)
            return (
              <Link key={t.id} href={`/v2/templates/${t.id}`} className={`card ${styles.podCard}`}>
                <span className={styles.podName}>{t.name}</span>
                {t.description && <p className={styles.muted}>{t.description}</p>}
                <div className={styles.field}>
                  <span>Delivers</span>
                  <div>{t.deliverables.length ? t.deliverables.map(d => `${d.label}${d.optional ? ' (optional)' : ''}`).join(', ') : 'Nothing yet'}</div>
                  <span>Tasks</span>
                  <div>{top}{subs ? ` + ${subs} subtask${subs === 1 ? '' : 's'}` : ''}</div>
                  <span>Starts</span>
                  <div>{days.length ? `${Math.max(...days)} days before launch` : 'No dates'}</div>
                </div>
                <span className={styles.inline}>{t.deliverables.map(d => <span key={d.key} className={styles.tag}>{deliverableLabel(d.kind)}</span>)}</span>
              </Link>
            )
          })}
        </div>
      )}
      <p className={styles.muted}>BFCM keeps its own planner for now.</p>
    </div>
  )
}
