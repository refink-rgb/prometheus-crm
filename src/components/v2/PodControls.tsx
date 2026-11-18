'use client'
// Prometheus 2.0: the small interactive pieces of the pods screens. Each one
// calls a server action; the action revalidates the page, so the server-rendered
// lists update on their own.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'
import { addPodMember, archivePod, createPod, removePodMember, renamePod, setClientPod } from '@/lib/v2/pod-actions'
import { roleLabel } from '@/lib/v2/model'
import styles from './v2.module.css'

type Option = { id: string; name: string }

export function CreatePodForm() {
  const [name, setName] = useState('')
  const [pending, start] = useTransition()
  const toast = useToast()
  const router = useRouter()
  return (
    <form
      className={styles.inline}
      onSubmit={e => {
        e.preventDefault()
        start(async () => {
          const res = await createPod(name)
          if (!res.ok) { toast.error(res.error); return }
          setName('')
          toast.success('Pod created. Add its people next.')
          router.push(`/v2/pods/${res.id}`)
        })
      }}
    >
      <label htmlFor="new-pod-name" className={styles.srOnly}>New pod name</label>
      <input id="new-pod-name" className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="New pod name, e.g. Pod A" maxLength={80} required />
      <button type="submit" className="btn-primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create pod'}</button>
    </form>
  )
}

export function RenamePodForm({ podId, name }: { podId: string; name: string }) {
  const [value, setValue] = useState(name)
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  const toast = useToast()
  if (!editing) {
    return (
      <div className={styles.titleRow}>
        <h1 className={styles.h1}>{name}</h1>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>Rename</button>
      </div>
    )
  }
  return (
    <form
      className={styles.inline}
      onSubmit={e => {
        e.preventDefault()
        start(async () => {
          const res = await renamePod(podId, value)
          if (!res.ok) { toast.error(res.error); return }
          setEditing(false)
          toast.success('Pod renamed.')
        })
      }}
    >
      <label htmlFor="pod-name" className={styles.srOnly}>Pod name</label>
      <input id="pod-name" className={styles.input} value={value} onChange={e => setValue(e.target.value)} maxLength={80} autoFocus required />
      <button type="submit" className="btn-primary" disabled={pending || !value.trim()}>{pending ? 'Saving…' : 'Save'}</button>
      <button type="button" className="btn-secondary" onClick={() => { setValue(name); setEditing(false) }}>Cancel</button>
    </form>
  )
}

export function ArchivePodButton({ podId, name, clientCount }: { podId: string; name: string; clientCount: number }) {
  const [pending, start] = useTransition()
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  return (
    <button
      type="button"
      className="btn-danger btn-sm"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          title: `Archive ${name}?`,
          message: clientCount
            ? `Its ${clientCount} client${clientCount === 1 ? '' : 's'} will have no pod until you move them to another one. Its history is kept.`
            : 'Its history is kept. You can create a new pod with the same name.',
          confirmLabel: 'Archive pod',
          danger: true,
        })
        if (!ok) return
        start(async () => {
          const res = await archivePod(podId)
          if (!res.ok) { toast.error(res.error); return }
          toast.success(`${name} archived.`)
          router.push('/v2/pods')
        })
      }}
    >{pending ? 'Archiving…' : 'Archive pod'}</button>
  )
}

export function AddMemberForm({ podId, role, people, disabledReason }: { podId: string; role: string; people: Option[]; disabledReason?: string }) {
  const [profileId, setProfileId] = useState('')
  const [pending, start] = useTransition()
  const toast = useToast()
  const id = `add-${role}-${podId}`
  if (disabledReason) return <p className={styles.muted}>{disabledReason}</p>
  if (!people.length) return <p className={styles.muted}>Everyone with access is already in this role.</p>
  return (
    <form
      className={styles.inline}
      onSubmit={e => {
        e.preventDefault()
        if (!profileId) return
        start(async () => {
          const res = await addPodMember(podId, profileId, role)
          if (!res.ok) { toast.error(res.error); return }
          setProfileId('')
        })
      }}
    >
      <label htmlFor={id} className={styles.srOnly}>Add a {roleLabel(role).toLowerCase()}</label>
      <select id={id} className={styles.input} value={profileId} onChange={e => setProfileId(e.target.value)}>
        <option value="">Add a {roleLabel(role).toLowerCase()}…</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="submit" className="btn-secondary btn-sm" disabled={pending || !profileId}>{pending ? 'Adding…' : 'Add'}</button>
    </form>
  )
}

export function RemoveMemberButton({ podId, profileId, role, name }: { podId: string; profileId: string; role: string; name: string }) {
  const [pending, start] = useTransition()
  const toast = useToast()
  return (
    <button
      type="button"
      className="link-btn"
      aria-label={`Remove ${name} as ${roleLabel(role).toLowerCase()}`}
      disabled={pending}
      onClick={() => start(async () => {
        const res = await removePodMember(podId, profileId, role)
        if (!res.ok) toast.error(res.error)
      })}
    >{pending ? 'Removing…' : 'Remove'}</button>
  )
}

/** Which pod looks after a client. Changing it moves their open work too. */
export function ClientPodSelect({ brandId, brandName, podId, pods }: { brandId: string; brandName: string; podId: string | null; pods: Option[] }) {
  const [value, setValue] = useState(podId ?? '')
  const [pending, start] = useTransition()
  const toast = useToast()
  const id = `pod-of-${brandId}`
  return (
    <span className={styles.inline}>
      <label htmlFor={id} className={styles.srOnly}>Pod for {brandName}</label>
      <select
        id={id}
        className={styles.input}
        value={value}
        disabled={pending}
        onChange={e => {
          const next = e.target.value
          const prev = value
          setValue(next)
          start(async () => {
            const res = await setClientPod(brandId, next || null)
            if (!res.ok) { setValue(prev); toast.error(res.error); return }
            const to = pods.find(p => p.id === next)?.name
            toast.success(to ? `${brandName} moved to ${to}.` : `${brandName} has no pod now.`)
          })
        }}
      >
        <option value="">No pod</option>
        {pods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </span>
  )
}

/** Add a client to this pod from the ones without a pod or in another pod. */
export function AddClientForm({ podId, podName, clients }: { podId: string; podName: string; clients: (Option & { podName: string | null })[] }) {
  const [brandId, setBrandId] = useState('')
  const [pending, start] = useTransition()
  const toast = useToast()
  const id = `add-client-${podId}`
  if (!clients.length) return <p className={styles.muted}>Every client is already in this pod.</p>
  const free = clients.filter(c => !c.podName)
  const taken = clients.filter(c => c.podName)
  return (
    <form
      className={styles.inline}
      onSubmit={e => {
        e.preventDefault()
        if (!brandId) return
        const c = clients.find(x => x.id === brandId)
        start(async () => {
          const res = await setClientPod(brandId, podId)
          if (!res.ok) { toast.error(res.error); return }
          setBrandId('')
          toast.success(`${c?.name ?? 'Client'} added to ${podName}.`)
        })
      }}
    >
      <label htmlFor={id} className={styles.srOnly}>Add a client</label>
      <select id={id} className={styles.input} value={brandId} onChange={e => setBrandId(e.target.value)}>
        <option value="">Add a client…</option>
        {free.length > 0 && <optgroup label="No pod yet">{free.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        {taken.length > 0 && <optgroup label="Move from another pod">{taken.map(c => <option key={c.id} value={c.id}>{c.name} · {c.podName}</option>)}</optgroup>}
      </select>
      <button type="submit" className="btn-secondary btn-sm" disabled={pending || !brandId}>{pending ? 'Adding…' : 'Add'}</button>
    </form>
  )
}
