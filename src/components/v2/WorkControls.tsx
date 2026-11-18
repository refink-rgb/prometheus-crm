'use client'
// Prometheus 2.0: inline controls on the work page. Each change saves at once
// and the page refreshes from the server.

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { setWorkStatus, updateTask, type TaskPatch } from '@/lib/v2/work-actions'
import { TASK_STATUSES, WORK_STATUSES, taskStatusStyle } from '@/lib/v2/model'
import styles from './v2.module.css'

function useSave() {
  const [pending, start] = useTransition()
  const toast = useToast()
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, undo?: () => void) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) { toast.error(res.error); undo?.() }
    })
  return { pending, run }
}

export function TaskStatusSelect({ taskId, status, title }: { taskId: string; status: string; title: string }) {
  const [value, setValue] = useState(status)
  const { pending, run } = useSave()
  const s = taskStatusStyle(value)
  return (
    <>
      <label htmlFor={`st-${taskId}`} className={styles.srOnly}>Status of {title}</label>
      <select
        id={`st-${taskId}`}
        className={`${styles.input} ${styles.statusSelect}`}
        style={{ color: s.fg, background: s.bg }}
        value={value}
        disabled={pending}
        onChange={e => {
          const next = e.target.value
          setValue(next)
          run(() => updateTask(taskId, { status: next }), () => setValue(status))
        }}
      >
        {!TASK_STATUSES.some(x => x.id === value) && <option value={value}>{s.label}</option>}
        {TASK_STATUSES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </>
  )
}

export function TaskOwnerSelect({ taskId, ownerId, title, people, podPeople }: {
  taskId: string; ownerId: string | null; title: string
  people: { id: string; name: string }[]
  podPeople: { id: string; name: string }[]
}) {
  const [value, setValue] = useState(ownerId ?? '')
  const { pending, run } = useSave()
  const others = people.filter(p => !podPeople.some(m => m.id === p.id))
  return (
    <>
      <label htmlFor={`ow-${taskId}`} className={styles.srOnly}>Who does {title}</label>
      <select
        id={`ow-${taskId}`}
        className={`${styles.input} ${value ? '' : styles.warn}`}
        value={value}
        disabled={pending}
        onChange={e => {
          const next = e.target.value
          setValue(next)
          run(() => updateTask(taskId, { owner_id: next || null } satisfies TaskPatch), () => setValue(ownerId ?? ''))
        }}
      >
        <option value="">Nobody yet</option>
        {podPeople.length > 0 && <optgroup label="In the pod">{podPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
        <optgroup label={podPeople.length ? 'Everyone else' : 'Everyone'}>{others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      </select>
    </>
  )
}

export function TaskDueInput({ taskId, due, title, late }: { taskId: string; due: string | null; title: string; late: boolean }) {
  const [value, setValue] = useState(due ?? '')
  const { pending, run } = useSave()
  return (
    <>
      <label htmlFor={`due-${taskId}`} className={styles.srOnly}>Due date of {title}</label>
      <input
        id={`due-${taskId}`}
        type="date"
        className={`${styles.input} ${late ? styles.lateInput : ''}`}
        value={value}
        disabled={pending}
        onChange={e => {
          const next = e.target.value
          setValue(next)
          run(() => updateTask(taskId, { due_date: next || null }), () => setValue(due ?? ''))
        }}
      />
    </>
  )
}

export function WorkStatusSelect({ workId, status }: { workId: string; status: string }) {
  const [value, setValue] = useState(status)
  const { pending, run } = useSave()
  return (
    <>
      <label htmlFor="work-status" className={styles.srOnly}>Work status</label>
      <select id="work-status" className={styles.input} value={value} disabled={pending}
        onChange={e => {
          const next = e.target.value
          setValue(next)
          run(() => setWorkStatus(workId, next), () => setValue(status))
        }}>
        {WORK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </>
  )
}
