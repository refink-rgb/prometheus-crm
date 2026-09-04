'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignProjectEditor } from '@/lib/actions'
import { useToast } from '@/components/Toast'
import { EDITOR_TRACK_META, profileName, type EditorTrack, type Profile } from '@/lib/types'
import { ChevronDown } from 'lucide-react'

const TRACK_COLOR: Record<EditorTrack, string> = {
  lp: 'var(--editor-lp)',
  creative: 'var(--editor-creative)',
}

function selectStyle(track: EditorTrack, hasValue: boolean, full: boolean): React.CSSProperties {
  const color = TRACK_COLOR[track]
  return {
    fontSize: 13,
    fontWeight: 500,
    color: hasValue ? color : 'var(--text-muted)',
    background: hasValue ? `color-mix(in srgb, ${color} 10%, transparent)` : 'var(--surface-raised)',
    border: `1px solid ${hasValue ? `color-mix(in srgb, ${color} 30%, transparent)` : 'var(--border)'}`,
    borderRadius: 7,
    padding: '5px 10px',
    cursor: 'pointer',
    width: full ? '100%' : 'fit-content',
  }
}

// An editor who was assigned and later had their capability turned off would
// drop out of the options list, silently showing "Unassigned" over a value
// that's still set in the DB. Keep them visible and labelled instead.
function StaleOption({ value, options, label }: { value: string; options: Profile[]; label: string }) {
  if (!value || options.some(p => p.id === value)) return null
  return <option value={value}>Assigned (no longer a {label})</option>
}

type Common = {
  track: EditorTrack
  /** Already filtered to profiles capable of this track. */
  options: Profile[]
  current: string | null
}

/**
 * Instant mode — commits on change. Used on the project detail page, which has
 * no surrounding form. Controlled, because it optimistically shows the new
 * value and must roll back if the action fails.
 */
function InstantEditorPicker({
  track, options, current, projectId, brandId,
}: Common & { projectId: string; brandId: string }) {
  const [value, setValue] = useState(current ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const toast = useToast()
  const label = EDITOR_TRACK_META[track].label

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    const prev = value
    setValue(next)
    startTransition(async () => {
      try {
        await assignProjectEditor(projectId, brandId, track, next || null)
        router.refresh()
      } catch (err) {
        // The old AssignedDesignerPicker swallowed this, so a rejected write
        // looked identical to a successful one until you reloaded the page.
        setValue(prev)
        toast.error(err instanceof Error ? err.message : `Failed to set ${label}.`)
      }
    })
  }

  // Dressed as a pill so it sits in the project header's chip row as one of
  // the chips ("LP · Internal Review", "CR · Brief") rather than a form field.
  const color = TRACK_COLOR[track]
  const hasValue = !!value
  const tag = track === 'lp' ? 'LP' : 'CR'
  return (
    <span
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        borderRadius: 999,
        fontSize: 11, fontWeight: 600,
        color: hasValue ? color : 'var(--text-secondary)',
        background: hasValue ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--surface-raised)',
        border: `1px solid ${hasValue ? `color-mix(in srgb, ${color} 35%, transparent)` : 'var(--border)'}`,
        opacity: isPending ? 0.6 : 1,
        transition: 'all 0.15s',
      }}
    >
      <span aria-hidden style={{ paddingLeft: 10, pointerEvents: 'none', opacity: 0.8 }}>{tag} ·</span>
      <select
        value={value}
        onChange={handleChange}
        disabled={isPending}
        aria-label={label}
        style={{
          appearance: 'none', WebkitAppearance: 'none',
          width: 'auto',
          fontSize: 11, fontWeight: 600,
          color: 'inherit', background: 'transparent', border: 'none',
          padding: '4px 24px 4px 5px',
          cursor: isPending ? 'progress' : 'pointer',
        }}
      >
        <option value="">Unassigned</option>
        {options.map(p => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
        <StaleOption value={value} options={options} label={label} />
      </select>
      <ChevronDown size={12} strokeWidth={2.2} aria-hidden style={{ position: 'absolute', right: 8, pointerEvents: 'none' }} />
    </span>
  )
}

/**
 * Form mode — carries a `name` and submits with the parent form, like
 * ProfitEngineerSelect. Deliberately UNCONTROLLED (defaultValue, no state):
 * ProjectEditForm and NewProjectForm read values off FormData on submit, and
 * per-field useState was removed from ProjectEditForm on purpose to fix a
 * re-render storm. Don't add state here.
 */
function FormEditorPicker({ track, options, current, fieldName }: Common & { fieldName: string }) {
  const label = EDITOR_TRACK_META[track].label
  return (
    <select
      name={fieldName}
      defaultValue={current ?? ''}
      aria-label={label}
      style={selectStyle(track, !!current, true)}
    >
      <option value="">Unassigned</option>
      {options.map(p => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
      <StaleOption value={current ?? ''} options={options} label={label} />
    </select>
  )
}

type Props =
  | (Common & { mode: 'instant'; projectId: string; brandId: string })
  | (Common & { mode: 'form'; fieldName: string })

export default function EditorPicker(props: Props) {
  return props.mode === 'instant'
    ? <InstantEditorPicker {...props} />
    : <FormEditorPicker {...props} />
}
