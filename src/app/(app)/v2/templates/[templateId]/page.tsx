import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { canUse2 } from '@/lib/permissions'
import { isUuid } from '@/lib/v2/model'
import { loadTemplate } from '@/lib/v2/work-server'
import TemplateEditor from '@/components/v2/TemplateEditor'
import MissingTables from '@/components/v2/MissingTables'
import styles from '@/components/v2/v2.module.css'

export default async function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params
  const user = await getCachedUser()
  if (!user) redirect('/login')
  if (!canUse2(user.email)) notFound()
  if (!isUuid(templateId)) notFound()
  const supabase = await createClient()
  const res = await loadTemplate(supabase, templateId)

  const crumbs = <div className={styles.crumbs}><Link href="/v2">2.0</Link> / <Link href="/v2/templates">Templates</Link></div>
  if (res.missing) return <div className={styles.page}>{crumbs}<MissingTables /></div>
  if (!res.template) notFound()

  return (
    <div className={styles.page}>
      {crumbs}
      {res.archived && <div className="card"><p className={styles.warn}>This template is archived. It can&apos;t be used for new work.</p></div>}
      {/* key: a save from elsewhere remounts the editor with the new version. */}
      <TemplateEditor key={res.template.updated_at} template={res.template} archived={res.archived} />
    </div>
  )
}
