'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from '@/components/Avatar'
import s from './AssigneePicker.module.css'

export type Person = { id: string; name: string }

/**
 * Avatars of everyone on a piece of work; click to add or remove people.
 * Shared by BFCM production tasks and Evergreen Ads. `showNames` writes the
 * names next to the avatars, for places with room (a detail page header).
 */
export default function AssigneePicker({ people, selected, disabled = false, title, onChange, className, align = 'right', showNames = false }: {
  people: Person[]
  selected: string[]
  disabled?: boolean
  title: string
  onChange: (ids: string[]) => void
  className?: string
  align?: 'left' | 'right'
  showNames?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  const chosen = selected.map(id => byId.get(id)).filter((p): p is Person => !!p)
  const options = people.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const names = chosen.map(p => p.name).join(', ')

  return <div className={`${s.people} ${className ?? ''}`} ref={ref}>
    <button type="button" className={s.stack} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={`People on ${title}: ${names || 'nobody'}`} onClick={() => setOpen(o => !o)}>
      {chosen.slice(0, 4).map(p => <Avatar key={p.id} name={p.name} size={24} title={p.name} />)}
      {chosen.length > 4 && <span className={s.more}>+{chosen.length - 4}</span>}
      {chosen.length === 0 && <span className={s.addPerson}>+</span>}
      {showNames && <span className={s.label}>{names || 'Add people'}</span>}
    </button>
    {open && <div className={`${s.popover} ${align === 'left' ? s.left : s.right}`} role="listbox" aria-multiselectable>
      <input className={s.search} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a teammate" aria-label="Find a teammate" />
      {options.map(p => {
        const on = selected.includes(p.id)
        return <button type="button" key={p.id} role="option" aria-selected={on} className={s.option} disabled={disabled} onClick={() => onChange(on ? selected.filter(id => id !== p.id) : [...selected, p.id])}>
          <Avatar name={p.name} size={22} />{p.name}{on && <span className={s.check}>✓</span>}
        </button>
      })}
      {options.length === 0 && <p className={s.empty}>No one matches.</p>}
    </div>}
  </div>
}
