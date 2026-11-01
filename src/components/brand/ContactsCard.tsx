'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteContact, saveBrandProfileFields, saveContact } from '@/lib/brands/actions'
import { CHANNELS, type BrandContact, type Channel } from '@/lib/brands/profile'

// Who we talk to at the client and how they want to be reached. Read first;
// each contact and the channel edit in place.

export default function ContactsCard({
  brandId, contacts, channel, channelDetails, canEdit,
}: {
  brandId: string
  contacts: BrandContact[]
  channel: Channel | null
  channelDetails: string | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [editingChannel, setEditingChannel] = useState(false)
  const sorted = [...contacts].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)

  return (
    <section className="mo-panel" aria-label="Points of contact">
      <div className="bp-card-head">
        <h2 className="mo-h2">Points of contact</h2>
        {canEdit && editing === null && <button className="bp-link" onClick={() => setEditing('new')}>+ Add</button>}
      </div>
      <div className="bp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {editingChannel ? (
          <ChannelForm brandId={brandId} channel={channel} details={channelDetails} onDone={() => setEditingChannel(false)} />
        ) : channel || channelDetails ? (
          <div className="bp-channel">
            <span className="mo-muted">Prefers</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{channel ? CHANNELS[channel] : 'Not set'}</b>
              {channelDetails && <span className="mo-muted"> · {channelDetails}</span>}
            </span>
            {canEdit && <button className="bp-link" style={{ fontSize: 13 }} onClick={() => setEditingChannel(true)}>Edit</button>}
          </div>
        ) : (
          <div className="bp-warn">
            <span style={{ flex: 1 }}>No preferred channel recorded.</span>
            {canEdit && <button className="bp-link" style={{ fontSize: 13 }} onClick={() => setEditingChannel(true)}>Set it</button>}
          </div>
        )}

        {editing === 'new' && <ContactForm brandId={brandId} onDone={() => setEditing(null)} />}

        {sorted.length === 0 && editing !== 'new' ? (
          <p className="bp-empty">No contacts yet. Add who approves work and who to chase for assets.</p>
        ) : (
          <ul className="bp-contacts">
            {sorted.map(c => editing === c.id ? (
              <li key={c.id}><ContactForm brandId={brandId} contact={c} onDone={() => setEditing(null)} /></li>
            ) : (
              <li key={c.id} className="bp-contact">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span><b>{c.name}</b>{c.is_primary && <span className="bp-primary">Primary</span>}</span>
                  {canEdit && editing === null && <button className="bp-link bp-link-muted" style={{ fontSize: 13 }} onClick={() => setEditing(c.id)}>Edit</button>}
                </div>
                {c.role && <span className="mo-muted">{c.role}</span>}
                {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}
                {c.notes && <span style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{c.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function ContactForm({ brandId, contact, onDone }: { brandId: string; contact?: BrandContact; onDone: () => void }) {
  const router = useRouter()
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const id = contact?.id ?? 'new'
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setErr('')
    start(async () => {
      const r = await fn()
      if (!r.ok) { setErr(r.error ?? 'Could not save.'); return }
      onDone()
      router.refresh()
    })
  }
  return (
    <form className="bp-form cr-save-box" action={fd => run(() => saveContact(fd))}>
      <input type="hidden" name="brand_id" value={brandId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <div className="bp-form-row">
        <div><label htmlFor={`cn-${id}`}>Name</label><input id={`cn-${id}`} name="name" defaultValue={contact?.name} required autoFocus /></div>
        <div><label htmlFor={`cr-${id}`}>Role</label><input id={`cr-${id}`} name="role" defaultValue={contact?.role ?? ''} placeholder="Founder, approves offers…" /></div>
      </div>
      <div className="bp-form-row">
        <div><label htmlFor={`ce-${id}`}>Email</label><input id={`ce-${id}`} name="email" type="email" defaultValue={contact?.email ?? ''} /></div>
        <div><label htmlFor={`cp-${id}`}>Phone / WhatsApp</label><input id={`cp-${id}`} name="phone" defaultValue={contact?.phone ?? ''} /></div>
      </div>
      <div><label htmlFor={`cx-${id}`}>Notes</label><input id={`cx-${id}`} name="notes" defaultValue={contact?.notes ?? ''} placeholder="e.g. Signs off anything with a discount" /></div>
      <label className="bp-check"><input type="checkbox" name="is_primary" defaultChecked={contact?.is_primary} /> Primary contact</label>
      {err && <p className="mo-error">{err}</p>}
      <div className="bp-actions">
        <button className="btn-primary" disabled={pending} style={{ fontSize: 14 }}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="bp-link bp-link-muted" onClick={onDone}>Cancel</button>
        {contact && (
          <button type="button" className="bp-link" style={{ marginLeft: 'auto', color: 'var(--danger)' }} disabled={pending}
            onClick={() => { if (confirm(`Remove ${contact.name}?`)) run(() => deleteContact(brandId, contact.id)) }}>
            Remove
          </button>
        )}
      </div>
    </form>
  )
}

function ChannelForm({ brandId, channel, details, onDone }: { brandId: string; channel: Channel | null; details: string | null; onDone: () => void }) {
  const router = useRouter()
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <form
      className="bp-form cr-save-box"
      action={fd => {
        setErr('')
        start(async () => {
          const r = await saveBrandProfileFields(brandId, {
            preferred_channel: String(fd.get('preferred_channel') ?? ''),
            channel_details: String(fd.get('channel_details') ?? ''),
          })
          if (!r.ok) { setErr(r.error); return }
          onDone()
          router.refresh()
        })
      }}
    >
      <div>
        <label htmlFor="pc">Preferred channel</label>
        <select id="pc" name="preferred_channel" defaultValue={channel ?? ''}>
          <option value="">Not set</option>
          {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="pcd">Where and how</label>
        <input id="pcd" name="channel_details" defaultValue={details ?? ''} placeholder="e.g. Slack Connect #acme-mm, replies mornings EST" />
      </div>
      {err && <p className="mo-error">{err}</p>}
      <div className="bp-actions">
        <button className="btn-primary" disabled={pending} style={{ fontSize: 14 }}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="bp-link bp-link-muted" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
