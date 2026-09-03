'use client'

import { useState, useEffect, useRef, memo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectDetails, type EditableProjectValues } from '@/lib/actions'
import Spinner from '@/components/Spinner'
import EditorPicker from '@/components/EditorPicker'
import { PAGE_TYPE_OPTIONS, editorsFor } from '@/lib/types'
import type { Journey, Profile } from '@/lib/types'

const OFFER_DYNAMICS_OPTIONS = [
  'BOGO',
  'GWP',
  'Buy X Get Y',
  'Flat Discount',
  'Tiered Discount',
  'Other',
] as const

interface Props {
  projectId: string
  brandId: string
  journeys: Journey[]
  profiles: Profile[]
  initial: {
    name: string
    due_date: string | null
    stage_brief_due_date: string | null
    stage_in_progress_due_date: string | null
    stage_internal_review_due_date: string | null
    stage_client_review_due_date: string | null
    offer_description: string | null
    offer: string | null
    cta: string | null
    headline: string | null
    body_copy: string | null
    supporting_message: string | null
    journey_id: string | null
    marketing_moment: 1 | 2 | null
    page_type: string | null
    product_featured: string | null
    product_description: string | null
    retail_price: string | null
    offer_dynamics_type: string | null
    competitor_reference: string | null
    client_ad_inspiration: string | null
    ad_copy_primary_text: string | null
    ad_copy_description: string | null
    ad_copy_url: string | null
    ad_headlines: string[] | null
    ad_subcopies: string[] | null
    ad_eyebrows: string[] | null
    product_images_link: string | null
    lp_url: string | null
    creatives_notes: string | null
    motion_link: string | null
    shopify_coupon_code: string | null
    lp_editor_id: string | null
    creative_editor_id: string | null
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: subtitle ? 'var(--space-1)' : 'var(--space-4)' }}>
        {title}
      </div>
      {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>{subtitle}</p>}
      {children}
    </div>
  )
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <span>{label}</span>
        {optional && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>optional</span>}
      </label>
      {children}
    </div>
  )
}

function padArray(values: string[] | null, size: number): string[] {
  const src = values ?? []
  return Array.from({ length: size }).map((_, i) => src[i] ?? '')
}

function cleanBank(values: string[]): string[] | null {
  const cleaned = values.map(v => v.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : null
}

// Memoized copy-bank: its own state lives here so typing in one row only
// re-renders this component (not the whole 400-line form). The parent reads
// the current values via ref when saving.
// Every slot carries the same `name`, so FormData.getAll(name) returns the bank
// in DOM order. That matters beyond convenience: it puts the bank inside the
// form, so save() can tell whether it rendered at all. A ref would survive an
// unmounted tab still holding mount-time values and write them back as if the
// user had typed them.
// The subset of columns whose value is `string | null`, so putText/putRaw can
// stay one-liners without widening the payload type.
type KeysOfType<T> = {
  [K in keyof EditableProjectValues]: EditableProjectValues[K] extends T ? K : never
}[keyof EditableProjectValues]

const CopyBank = memo(function CopyBank({
  name,
  placeholderPrefix,
  initial,
}: {
  name: string
  count: number
  placeholderPrefix: string
  initial: string[]
}) {
  return (
    <>
      {initial.map((v, i) => (
        <input
          key={i}
          type="text"
          name={name}
          defaultValue={v}
          placeholder={`${placeholderPrefix} ${i + 1}`}
          style={{ marginBottom: 8 }}
        />
      ))}
    </>
  )
})

// Marketing Moment picker isolated into its own memoized component so the
// tri-state button rerender doesn't touch the rest of the form.
const MomentPicker = memo(function MomentPicker({
  name,
  initial,
}: {
  name: string
  initial: '' | '1' | '2'
}) {
  const [value, setValue] = useState<'' | '1' | '2'>(initial)
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {/* Same reason as CopyBank: the value belongs in the form, not a ref, so
          save() can distinguish "set to None" from "not on this tab". */}
      <input type="hidden" name={name} value={value} readOnly />
      {(['', '1', '2'] as const).map(m => (
        <button
          key={m}
          type="button"
          onClick={() => setValue(m)}
          style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500,
            border: `1px solid ${value === m ? 'var(--accent)' : 'var(--border)'}`,
            background: value === m ? 'var(--accent-muted)' : 'transparent',
            color: value === m ? 'var(--accent)' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          {m === '' ? 'None' : m === '1' ? 'Moment 1 (1st half)' : 'Moment 2 (2nd half)'}
        </button>
      ))}
    </div>
  )
})

export default function ProjectEditForm({ projectId, brandId, journeys, profiles, initial }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Bumped on cancel to remount the form and reset all defaultValue inputs.
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    function handleOpen() {
      setEditing(true)
      setTimeout(() => containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
    window.addEventListener('prometheus-open-edit', handleOpen)
    return () => window.removeEventListener('prometheus-open-edit', handleOpen)
  }, [])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Every input is uncontrolled (defaultValue) and read from FormData at save
  // time, including the copy banks and the moment picker. Nothing about the
  // pending edit lives outside the form, which is what lets save() treat
  // "absent from FormData" as "not on screen".
  function cancel() {
    setError('')
    setFormKey(k => k + 1) // remount to reset defaultValue inputs
    setEditing(false)
  }

  async function save() {
    const form = formRef.current
    if (!form) return
    const fd = new FormData(form)
    const s = (k: string): string => (fd.get(k) as string ?? '').toString()

    // A column only enters the payload when its input actually rendered.
    // updateProjectDetails writes exactly the keys it is handed, so a field
    // that isn't on screen is left alone rather than blanked. Today every
    // field renders at once and this is a no-op; under the tabbed layout it is
    // the thing that stops an LP editor's save from nulling product_featured,
    // retail_price and product_images_link on the tab they can't see.
    const patch: Partial<EditableProjectValues> = {}
    const put = <K extends keyof EditableProjectValues>(k: K, v: EditableProjectValues[K]) => {
      if (fd.has(k)) patch[k] = v
    }
    // Blank-to-null, for the fields where empty means "unset".
    const putText = (k: KeysOfType<string | null>) => put(k, s(k).trim() || null)
    const putRaw = (k: KeysOfType<string | null>) => put(k, s(k) || null)
    const putBank = (k: 'ad_headlines' | 'ad_subcopies' | 'ad_eyebrows') =>
      put(k, cleanBank(fd.getAll(k).map(String)))

    if (fd.has('name')) {
      const nameVal = s('name').trim()
      if (!nameVal) {
        setError('Project name is required.')
        return
      }
      patch.name = nameVal
    }

    putRaw('due_date')
    putRaw('stage_brief_due_date')
    putRaw('stage_in_progress_due_date')
    putRaw('stage_internal_review_due_date')
    putRaw('stage_client_review_due_date')
    putRaw('journey_id')
    putRaw('page_type')
    putRaw('offer_dynamics_type')
    putRaw('lp_editor_id')
    putRaw('creative_editor_id')

    putText('offer_description')
    putText('offer')
    putText('cta')
    putText('headline')
    putText('body_copy')
    putText('supporting_message')
    putText('product_description')
    putText('retail_price')
    putText('competitor_reference')
    putText('client_ad_inspiration')
    putText('ad_copy_primary_text')
    putText('ad_copy_description')
    putText('ad_copy_url')
    putText('product_images_link')
    putText('creatives_notes')
    putText('motion_link')

    putBank('ad_headlines')
    putBank('ad_subcopies')
    putBank('ad_eyebrows')

    const moment = s('marketing_moment')
    put('marketing_moment', moment === '1' ? 1 : moment === '2' ? 2 : null)

    setSaving(true)
    setError('')
    try {
      await updateProjectDetails(projectId, brandId, patch)
      setEditing(false)
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div ref={containerRef} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
        <button onClick={() => setEditing(true)} className="btn-secondary btn-sm">
          ✏ Edit details
        </button>
      </div>
    )
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      cancel()
    }
  }

  const momentInitial: '' | '1' | '2' = initial.marketing_moment
    ? String(initial.marketing_moment) as '1' | '2'
    : ''

  return (
    <div ref={containerRef} className="card" style={{ marginBottom: 24 }} onKeyDown={handleKeyDown}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Edit Project</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving} className="btn-primary" aria-live="polite" style={{ fontSize: 13 }}>
            {saving ? <><Spinner size="sm" /> Saving…</> : 'Save changes'}
          </button>
          <button onClick={cancel} disabled={saving} className="btn-secondary" style={{ fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* All scalar inputs live inside this form and are uncontrolled — they
          never trigger a re-render on keystroke. Save reads FormData; cancel
          bumps formKey to remount and reset defaultValues. */}
      <form
        key={formKey}
        ref={formRef}
        onSubmit={e => { e.preventDefault(); save() }}
      >
        {/* ── Basics ── */}
        <Section title="Basics">
          <div className="form-grid-2">
            <Field label="Project name">
              <input type="text" name="name" defaultValue={initial.name} />
            </Field>
            <Field label="Launch date (Live)" optional>
              <input type="date" name="due_date" defaultValue={initial.due_date ?? ''} />
            </Field>
          </div>

          <div className="form-grid-2">
            <Field label="LP editor" optional>
              <EditorPicker
                mode="form"
                track="lp"
                fieldName="lp_editor_id"
                options={editorsFor(profiles, 'is_lp_editor')}
                current={initial.lp_editor_id}
              />
            </Field>
            <Field label="Creative editor" optional>
              <EditorPicker
                mode="form"
                track="creative"
                fieldName="creative_editor_id"
                options={editorsFor(profiles, 'is_creative_editor')}
                current={initial.creative_editor_id}
              />
            </Field>
          </div>

          <Field label="Journey" optional>
            <select name="journey_id" defaultValue={initial.journey_id ?? ''}>
              <option value="">(No journey)</option>
              {journeys.map(j => (
                <option key={j.id} value={j.id}>{j.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Marketing Moment" optional>
            <MomentPicker name="marketing_moment" initial={momentInitial} />
          </Field>
        </Section>

        {/* ── Stage timeline ── */}
        <Section title="Stage timeline" subtitle="Target dates per phase — informational, not enforced.">
          <div className="form-grid-2">
            <Field label="Brief due" optional>
              <input type="date" name="stage_brief_due_date" defaultValue={initial.stage_brief_due_date ?? ''} />
            </Field>
            <Field label="In Progress due" optional>
              <input type="date" name="stage_in_progress_due_date" defaultValue={initial.stage_in_progress_due_date ?? ''} />
            </Field>
            <Field label="Internal Review due" optional>
              <input type="date" name="stage_internal_review_due_date" defaultValue={initial.stage_internal_review_due_date ?? ''} />
            </Field>
            <Field label="Client Review due" optional>
              <input type="date" name="stage_client_review_due_date" defaultValue={initial.stage_client_review_due_date ?? ''} />
            </Field>
          </div>
        </Section>

        {/* ── Shared brief ── */}
        <Section title="Shared brief" subtitle="Used by both LP and Creatives.">
          <Field label="Offer / Promo" optional>
            <select name="offer_dynamics_type" defaultValue={initial.offer_dynamics_type ?? ''} style={{ marginBottom: 8 }}>
              <option value="">Select offer type…</option>
              {OFFER_DYNAMICS_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <input type="text" name="offer" defaultValue={initial.offer ?? ''} placeholder="Details — e.g. Buy 2 Get 1 Free, 20% off orders $75+" />
          </Field>
          <Field label="Offer overview" optional>
            <textarea name="offer_description" defaultValue={initial.offer_description ?? ''} rows={4} style={{ resize: 'vertical' }} />
          </Field>

          <Field label="Hero headline" optional>
            <input type="text" name="headline" defaultValue={initial.headline ?? ''} placeholder="The main hook for this moment" />
          </Field>
          <Field label="Body copy" optional>
            <textarea name="body_copy" defaultValue={initial.body_copy ?? ''} rows={4} style={{ resize: 'vertical' }} />
          </Field>
          <Field label="Supporting message" optional>
            <textarea name="supporting_message" defaultValue={initial.supporting_message ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </Field>
          <Field label="Call to action" optional>
            <input type="text" name="cta" defaultValue={initial.cta ?? ''} placeholder="e.g. Shop Now, Claim Your Deal" />
          </Field>

          {/* product_featured is no longer edited here. The Products card on the
              Creatives tab owns it: it holds the per-product links and mirrors
              the names back into this column on every save. Two writers meant
              editing the text here silently did nothing visible — the read layer
              prefers the structured list — while still overwriting the mirror. */}
          <Field label="Product description" optional>
            <textarea name="product_description" defaultValue={initial.product_description ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </Field>
        </Section>

        {/* ── LP-only ── */}
        <Section title="LP-only">
          <Field label="Page type" optional>
            <select name="page_type" defaultValue={initial.page_type ?? ''}>
              <option value="">Select page type…</option>
              {PAGE_TYPE_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ── Creatives-only ── */}
        <Section title="Creatives-only">
          <Field label="Headlines (5 variations)" optional>
            <CopyBank name="ad_headlines" count={5} placeholderPrefix="Headline" initial={padArray(initial.ad_headlines, 5)} />
          </Field>
          <Field label="Subcopy (5 variations)" optional>
            <CopyBank name="ad_subcopies" count={5} placeholderPrefix="Subcopy" initial={padArray(initial.ad_subcopies, 5)} />
          </Field>
          <Field label="Eyebrows (3 variations)" optional>
            <CopyBank name="ad_eyebrows" count={3} placeholderPrefix="Eyebrow" initial={padArray(initial.ad_eyebrows, 3)} />
          </Field>

          <Field label="Ad Copy — Primary text" optional>
            <textarea name="ad_copy_primary_text" defaultValue={initial.ad_copy_primary_text ?? ''} rows={3} style={{ resize: 'vertical' }} />
          </Field>
          <Field label="Ad Copy — Description" optional>
            <input type="text" name="ad_copy_description" defaultValue={initial.ad_copy_description ?? ''} />
          </Field>
          <Field label="Ad Copy — URL" optional>
            <input type="url" name="ad_copy_url" defaultValue={initial.ad_copy_url ?? ''} placeholder="https://…" />
          </Field>

          <Field label="Retail price / value" optional>
            <input type="text" name="retail_price" defaultValue={initial.retail_price ?? ''} placeholder='e.g. $29.99, "$29.99 value"' />
          </Field>

          <Field label="Competitor reference" optional>
            <textarea name="competitor_reference" defaultValue={initial.competitor_reference ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </Field>
          <Field label="Client ad inspiration" optional>
            <textarea name="client_ad_inspiration" defaultValue={initial.client_ad_inspiration ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </Field>

          <Field label="Product images link" optional>
            <input type="url" name="product_images_link" defaultValue={initial.product_images_link ?? ''} placeholder="Drive folder or external URL" />
          </Field>
        </Section>

        {/* ── Final output ── */}
        {/* The landing page URL and discount code are submitted from the
            Final output card on the Landing Page tab, where "No page yet" is
            shown, not from here. */}
        <Section title="Final output">
          <Field label="Creatives link / notes" optional>
            <textarea name="creatives_notes" defaultValue={initial.creatives_notes ?? ''} rows={2} style={{ resize: 'vertical' }} />
          </Field>
          {/* motion_link was already whitelisted by updateProjectDetails but had
              no input here, so its only writer was the Deliverables form on the
              old project page. It now has one writer that lives with the rest of
              the project's fields. */}
          <Field label="Motion link" optional>
            <input
              type="url"
              name="motion_link"
              defaultValue={initial.motion_link ?? ''}
              placeholder="https://projects.motionapp.com/…"
            />
          </Field>
        </Section>
      </form>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
        <button onClick={save} disabled={saving} className="btn-primary" aria-live="polite" style={{ fontSize: 13 }}>
          {saving ? <><Spinner size="sm" /> Saving…</> : 'Save changes'}
        </button>
        <button onClick={cancel} disabled={saving} className="btn-secondary" style={{ fontSize: 13 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
