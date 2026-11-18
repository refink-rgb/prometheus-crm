'use client'
// Prometheus 2.0: creating a piece of work. The plan underneath is the exact
// list of tasks that will be made, with dates and owners, so nothing is a
// surprise after clicking Create. The server works the plan out again from the
// same template before saving.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { createWork } from '@/lib/v2/work-actions'
import { POD_ROLES, roleLabel, type PodRole } from '@/lib/v2/model'
import { easternToday } from '@/lib/eastern'
import { formatDay, planWork, type WorkTemplate } from '@/lib/v2/templates'
import styles from './v2.module.css'

type Client = { id: string; name: string; podId: string | null }
type Pod = { id: string; name: string; members: { id: string; name: string; role: string }[] }
type Person = { id: string; name: string }


export default function NewWorkForm({ initialClientId, clients, pods, people, templates }: {
  initialClientId: string
  clients: Client[]
  pods: Pod[]
  people: Person[]
  templates: WorkTemplate[]
}) {
  const [clientId, setClientId] = useState(clients.some(c => c.id === initialClientId) ? initialClientId : '')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const template = templates.find(t => t.id === templateId) ?? null
  const [include, setInclude] = useState<string[]>(() => template?.deliverables.filter(d => d.optional).map(d => d.key) ?? [])
  const [name, setName] = useState('')
  const [launch, setLaunch] = useState('')
  // Only roles someone changed by hand; everything else comes from the pod.
  const [overrides, setOverrides] = useState<Partial<Record<PodRole, string | null>>>({})
  const [pending, start] = useTransition()
  const toast = useToast()
  const router = useRouter()

  const client = clients.find(c => c.id === clientId) ?? null
  const pod = client?.podId ? pods.find(p => p.id === client.podId) ?? null : null
  const fromPod = (role: PodRole) => pod?.members.find(m => m.role === role)?.id ?? null
  const assign: Partial<Record<PodRole, string | null>> = {}
  for (const r of POD_ROLES) assign[r.id] = r.id in overrides ? overrides[r.id] ?? null : fromPod(r.id)

  const plan = template && launch ? planWork(template, { include, launch, assign }) : null
  const nameOf = (id: string | null) => (id ? people.find(p => p.id === id)?.name ?? 'Someone' : null)
  const today = easternToday()
  const late = plan?.tasks.filter(t => t.due_date && t.due_date < today).length ?? 0
  const unassigned = plan?.tasks.filter(t => t.role && !t.owner_id).length ?? 0
  const included = template?.deliverables.filter(d => !d.optional || include.includes(d.key)) ?? []

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    setInclude(templates.find(t => t.id === id)?.deliverables.filter(d => d.optional).map(d => d.key) ?? [])
  }

  const submit = () => {
    if (!client) { toast.error('Pick a client.'); return }
    if (!template) { toast.error('Pick what kind of work this is.'); return }
    if (!launch) { toast.error('Pick a launch date.'); return }
    if (!name.trim()) { toast.error('Give the work a name.'); return }
    if (!included.length) { toast.error('Choose at least one deliverable.'); return }
    start(async () => {
      const res = await createWork({ brandId: client.id, templateId: template.id, name, launchDate: launch, include, assign })
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Work created.')
      router.push(`/v2/work/${res.id}`)
    })
  }

  return (
    <form className={styles.newWork} onSubmit={e => { e.preventDefault(); submit() }}>
      <section className={`card ${styles.panel}`} aria-label="The work">
        <div className={styles.formGrid}>
          <label className={styles.stack}>
            <span className={styles.label}>Client</span>
            <select className={styles.input} value={clientId} onChange={e => { setClientId(e.target.value); setOverrides({}) }} required>
              <option value="">Pick a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className={styles.stack}>
            <span className={styles.label}>Kind of work</span>
            <select className={styles.input} value={templateId} onChange={e => pickTemplate(e.target.value)} required>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className={styles.stack}>
            <span className={styles.label}>Name</span>
            <input className={styles.input} value={name} onChange={e => setName(e.target.value)} maxLength={200} required
              placeholder={template ? `e.g. ${template.name} · gift guide` : 'What this work is'} />
          </label>
          <label className={styles.stack}>
            <span className={styles.label}>Launch date</span>
            <input type="date" className={styles.input} value={launch} onChange={e => setLaunch(e.target.value)} required />
          </label>
        </div>
        {template?.description && <p className={styles.muted}>{template.description}</p>}

        {template && template.deliverables.length > 0 && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>What it delivers</legend>
            <div className={styles.inline}>
              {template.deliverables.map(d => (
                <label key={d.key} className={styles.chip}>
                  <input type="checkbox" disabled={!d.optional} checked={!d.optional || include.includes(d.key)}
                    onChange={e => setInclude(xs => (e.target.checked ? [...xs, d.key] : xs.filter(k => k !== d.key)))} />
                  {d.label}{!d.optional && <span className={styles.muted}> (always)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      {client && template && (
        <section className={`card ${styles.panel}`} aria-label="Who does it">
          <div className={styles.spread}>
            <h2 className={styles.h2}>Who does it</h2>
            {pod ? <Link href={`/v2/pods/${pod.id}`} className={styles.muted}>From {pod.name} →</Link> : null}
          </div>
          {!pod && (
            <p className={styles.warn}>{client.name} isn&apos;t in a pod yet, so nobody is picked. Choose people below, or <Link href="/v2/pods">put them in a pod</Link> first.</p>
          )}
          <div className={styles.formGrid}>
            {(plan?.roles ?? POD_ROLES.map(r => r.id).filter(r => template.tasks.some(t => t.role === r))).map(role => {
              const inPod = pod?.members.filter(m => m.role === role) ?? []
              const others = people.filter(p => !inPod.some(m => m.id === p.id))
              return (
                <label key={role} className={styles.stack}>
                  <span className={styles.label}>{roleLabel(role)}</span>
                  <select className={styles.input} value={assign[role] ?? ''}
                    onChange={e => setOverrides(o => ({ ...o, [role]: e.target.value || null }))}>
                    <option value="">Nobody yet</option>
                    {inPod.length > 0 && (
                      <optgroup label={`In ${pod?.name}`}>
                        {inPod.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </optgroup>
                    )}
                    <optgroup label={inPod.length ? 'Everyone else' : 'Everyone'}>
                      {others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </optgroup>
                  </select>
                </label>
              )
            })}
          </div>
        </section>
      )}

      <section className={`card ${styles.panel}`} aria-label="The plan">
        <div className={styles.spread}>
          <h2 className={styles.h2}>The plan{plan ? ` · ${plan.tasks.length} tasks` : ''}</h2>
          {plan && <span className={styles.muted}>Launch {formatDay(launch)}</span>}
        </div>
        {!plan ? (
          <p className={styles.muted}>Pick a kind of work and a launch date to see every task with its date.</p>
        ) : (
          <>
            {(late > 0 || unassigned > 0) && (
              <div className={styles.stack}>
                {late > 0 && <p className={styles.warn}>{late} task{late === 1 ? ' is' : 's are'} already past due with this launch date. Pick a later launch, or change the dates after creating.</p>}
                {unassigned > 0 && <p className={styles.warn}>{unassigned} task{unassigned === 1 ? ' has' : 's have'} nobody yet.</p>}
              </div>
            )}
            {[null, ...plan.deliverables.map(d => d.key)].map(section => {
              const rows = plan.tasks.filter(t => t.deliverable === section)
              if (!rows.length) return null
              const d = plan.deliverables.find(x => x.key === section)
              return (
                <div key={section ?? 'general'} className={styles.stack}>
                  <h3 className={styles.h3}>{d ? d.label : 'Whole piece of work'}</h3>
                  <div className={styles.list}>
                    {rows.map(t => {
                      const owner = nameOf(t.owner_id)
                      const past = t.due_date && t.due_date < today
                      return (
                        <div key={t.key} className={`${styles.planRow} ${t.parent ? styles.planSub : ''}`}>
                          <span className={past ? styles.warn : styles.muted}>{formatDay(t.due_date)}</span>
                          <span>{t.title}</span>
                          <span className={owner ? styles.muted : styles.warn}>{owner ?? (t.role ? `${roleLabel(t.role)}: nobody yet` : '')}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </section>

      <div className={styles.inline}>
        <button type="submit" className="btn-primary" disabled={pending || !client || !template || !launch || !name.trim() || !included.length}>
          {pending ? 'Creating…' : 'Create work'}
        </button>
        <Link href="/v2/work" className="btn-secondary">Cancel</Link>
      </div>
    </form>
  )
}
