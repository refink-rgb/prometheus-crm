'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BRAND_DOC_ACCEPT, BRAND_DOC_BUCKET, MAX_BRAND_DOC_BYTES, MB, resolveDocType } from '@/lib/brand-docs'
import {
  ADS_BY, AI_CHOICES, DISCOUNTS_BY, PLATFORMS, STORE_ACCESS, intakeCompleteness,
  type Choice, type IntakeForm,
} from '@/lib/brands/intake'
import { attachIntakeFile, createIntakeUploadUrl, removeIntakeFile, saveIntake } from '@/lib/brands/intake-actions'

// The page a new client fills in. Written for someone on their phone between
// meetings: every answer saves itself, files go up by tap or drop, nothing is
// required, and they can come back to the same link to add more.
//
// Only asks what we cannot get from their website or their brand guidelines.

export interface IntakeFile {
  id: string
  file_name: string
  kind: string
  byte_size: number
  from_client: boolean
}

const FILE_SLOTS = [
  { kind: 'guidelines', title: 'Brand guidelines / brand book', hint: 'The most important file here. Usually a PDF.', key: true },
  { kind: 'logo', title: 'Logo', hint: 'Vector if you have it (SVG, AI, EPS, PDF), plus a PNG. Light and dark versions if they exist.' },
  { kind: 'product_images', title: 'Product images', hint: 'The highest quality you have: packshots, lifestyle shots, close-ups. Select many at once.' },
  { kind: 'fonts', title: 'Fonts', hint: 'Font files (OTF, TTF, WOFF) or a .zip.' },
  { kind: 'other', title: 'Anything else useful', hint: 'Product sheets, past ads, customer research, reviews.' },
] as const

const AUTOSAVE_MS = 900

type TextKey = { [K in keyof IntakeForm]: IntakeForm[K] extends string ? K : never }[keyof IntakeForm]

type Setter = <K extends keyof IntakeForm>(k: K, v: IntakeForm[K]) => void
// Shared with the question components below. They live outside the page
// component: defined inside it, every keystroke would remount the input and
// drop focus.
const FormCtx = createContext<{ form: IntakeForm; set: Setter } | null>(null)
const useForm = () => useContext(FormCtx)!

/** A text question. */
function Q({ k, label, hint, placeholder, rows = 3 }: { k: TextKey; label: string; hint?: string; placeholder?: string; rows?: number }) {
  const { form, set } = useForm()
  return (
    <label className="ik-field">
      <span>{label}</span>
      {rows === 1
        ? <input value={form[k]} onChange={e => set(k, e.target.value)} placeholder={placeholder} />
        : <textarea rows={rows} value={form[k]} onChange={e => set(k, e.target.value)} placeholder={placeholder} />}
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** A question with fixed answers. Tap again to clear. */
function Pick({ k, label, choices }: { k: 'platform' | 'store_access' | 'discounts_by' | 'ads_by'; label: string; choices: Choice[] }) {
  const { form, set } = useForm()
  return (
    <div className="ik-field">
      <span>{label}</span>
      <div className="ik-pills" role="radiogroup" aria-label={label}>
        {choices.map(c => (
          <button key={c.v} type="button" role="radio" aria-checked={form[k] === c.v}
            className={`ik-pill${form[k] === c.v ? ' on' : ''}`} onClick={() => set(k, form[k] === c.v ? '' : c.v)}>{c.label}</button>
        ))}
      </div>
    </div>
  )
}

export default function IntakeFormView({
  token, brandName, initial, files: initialFiles, submittedAt,
}: {
  token: string
  brandName: string
  initial: IntakeForm
  files: IntakeFile[]
  submittedAt: string | null
}) {
  const [form, setForm] = useState<IntakeForm>(initial)
  const [files, setFiles] = useState<IntakeFile[]>(initialFiles)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveErr, setSaveErr] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const first = useRef(true)

  // Autosave: every change, debounced. Nothing the client types is lost to a
  // closed tab.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setSaveState('saving')
    const t = setTimeout(async () => {
      const r = await saveIntake(token, form, false)
      if (r.ok) { setSaveState('saved'); setSaveErr('') } else { setSaveState('error'); setSaveErr(r.error) }
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [form, token])

  const set: Setter = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const items = useMemo(() => intakeCompleteness({
    form, docKinds: files.map(f => f.kind), hasGuidelineText: false, aiSensitivity: form.ai, contactCount: 0,
  }), [form, files])
  const doneCount = items.filter(i => i.done).length
  const hasGuidelines = files.some(f => f.kind === 'guidelines')

  function submit() {
    start(async () => {
      const r = await saveIntake(token, form, true)
      if (r.ok) { setDone(r.savedAt); window.scrollTo({ top: 0, behavior: 'smooth' }) }
      else { setSaveState('error'); setSaveErr(r.error) }
    })
  }

  const swatches = useMemo(() => Array.from(new Set(form.colours.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) ?? [])).slice(0, 12), [form.colours])

  const slot = (s: { kind: string; title: string; hint: string; key?: boolean }) => (
    <UploadSlot
      key={s.kind}
      token={token}
      kind={s.kind}
      title={s.title}
      hint={s.hint}
      badge={s.key ? 'Most important' : undefined}
      files={files.filter(f => f.kind === s.kind)}
      onAdded={f => setFiles(fs => [...fs, f])}
      onRemoved={id => setFiles(fs => fs.filter(f => f.id !== id))}
    />
  )

  return (
    <FormCtx.Provider value={{ form, set }}>
    <div className="ik-page">
      <header className="ik-top">
        <div className="ik-top-inner">
          <span className="ik-brand">{brandName}</span>
          <span className={`ik-save ik-save-${saveState}`} aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Not saved' : 'Saves as you type'}
          </span>
        </div>
        <div className="ik-progress" aria-label={`${doneCount} of ${items.length} done`}>
          <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
      </header>

      <main className="ik-main">
        {done && (
          <div className="ik-card ik-thanks">
            <h2>Thank you! 🎉</h2>
            <p>The team has everything you sent. You can come back to this same link any time to add or change something; it saves as you go.</p>
            <button className="ik-btn-secondary" onClick={() => setDone(null)}>OK</button>
          </div>
        )}

        <section className="ik-intro">
          <h1>Let&apos;s get {brandName} set up</h1>
          <p>
            This is what our designers, copywriters and editors need before they start, and what we can&apos;t find on your
            website. Skip anything you don&apos;t have; it all saves automatically, and you can come back to this link later.
          </p>
          <p className="ik-count"><b>{doneCount} of {items.length}</b> done{doneCount < items.length && <> · still to go: {items.filter(i => !i.done).map(i => i.label.toLowerCase()).join(', ')}</>}</p>
        </section>

        {saveState === 'error' && <div className="ik-alert">{saveErr}</div>}

        <section className="ik-card">
          <h2><span className="ik-step">1</span> Your brand files</h2>
          <p className="ik-help">Tap a box to pick files, or drag them in. Up to {MAX_BRAND_DOC_BYTES / MB}MB each.</p>
          <div className="ik-slots">{FILE_SLOTS.map(slot)}</div>
          <Q k="asset_links" rows={2} label="Files too big, or already in a folder? Paste a link instead"
            placeholder="Google Drive, Dropbox or WeTransfer link to your product photos, logo pack, etc." />
          {!hasGuidelines && (
            <div className="ik-sub">
              <p className="ik-help" style={{ margin: 0 }}>No brand guidelines? Then tell us your colours and fonts.</p>
              <label className="ik-field">
                <span>Brand colours</span>
                <input value={form.colours} onChange={e => set('colours', e.target.value)} placeholder="e.g. #0E3B2E forest green, #F4EDE4 cream, #E8743B accent" />
                {swatches.length > 0 && <div className="ik-swatches">{swatches.map(c => <span key={c} title={c} style={{ background: c }} />)}</div>}
              </label>
              <Q k="fonts" rows={1} label="Fonts" placeholder="e.g. Headlines: Canela, Body: Inter" />
            </div>
          )}
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">2</span> Products &amp; offers</h2>
          <Q k="push_products" label="Which products should we push?" hint="Best sellers, best margins, new launches, and why."
            placeholder={'e.g. Vitamin C Serum: best seller, highest margin\nNew SPF launching in March'} />
          <Q k="avoid_products" rows={2} label="Any products we should leave out?" hint="Low stock, being discontinued, or just not ones to advertise."
            placeholder="e.g. Night Cream is low on stock until April" />
          <Q k="past_offers" rows={4} label="Which offers have you tested before, and how did they do?"
            hint="What the offer was, the conditions, and what happened. Good and bad results both help."
            placeholder={'e.g. BFCM 2025: 25% off sitewide, 1 week. Best month ever, but margins hurt.\nFree gift over $75: OK, not great.'} />
          <Q k="offer_limits" rows={2} label="Any limits on discounts or offers?"
            placeholder="e.g. Never more than 20% off, no stacking codes, never discount the starter kit" />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">3</span> Your customers &amp; market</h2>
          <Q k="reasons" label="Why do customers pick you over the alternatives?" hint="List as many reasons as come to mind." />
          <Q k="buyer" label="Who is your main buyer?" hint="Age, life stage, what they care about. Mention a second type if there is one (gifting, wholesale…)." />
          <Q k="frustrations" rows={2} label="What frustrates them about the other options out there?" />
          <Q k="proof" rows={2} label="What backs up your promise?" hint="Review count and rating, results, press, awards, clinical data: anything we can quote." />
          <Q k="competitors" rows={2} label="Who are your main competitors?" />
          <Q k="steer_clear" rows={2} label="Any brands whose tone or tactics we should steer clear of, and why?" />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">4</span> What your guidelines don&apos;t tell us</h2>
          <p className="ik-help">Brands grow past their guidelines. Tell us what has changed, and the things you&apos;d only learn by working with you.</p>
          <Q k="brand_changes" label="How has the brand changed since your guidelines were made?"
            placeholder="e.g. We've moved away from the pastel look; the tone is more direct now" />
          <Q k="past_ads" label="Ads or content that worked for you, and ones that didn't"
            hint="Links or descriptions. Why they worked helps most." />
          <Q k="copy_donts" rows={3} label="Words, claims or phrases we should never use"
            hint="One per line. Each becomes a rule the whole team sees."
            placeholder={'e.g. Never say "cure"\nNo "anti-ageing": say "skin renewal"'} />
          <Q k="design_donts" rows={2} label="Visual don'ts" hint="One per line."
            placeholder={'e.g. No product on a pure white background'} />
          <Q k="campaign_style" label="Do your sales and campaigns look or sound different?"
            hint="Fonts, colours or wording you use for Black Friday and other sales, if they differ from the everyday brand."
            placeholder={'e.g. Black Friday uses Anton in all caps on black\nWe say "Black Friday Deals", never "Special Offers"'} />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">5</span> Video &amp; music</h2>
          <Q k="footage_link" rows={2} label="Link to existing footage"
            hint="Product videos, UGC, behind the scenes, past ads: a Drive or Dropbox folder is perfect." />
          <Q k="music" rows={2} label="Music you like, and music you don't"
            placeholder="e.g. Upbeat, no lyrics. Never trap or anything that sounds like TikTok trends. Example: link to a song you love" />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">6</span> How do you feel about AI?</h2>
          <p className="ik-help">We sometimes use AI to create or touch up images and draft copy. Some brands love it, some don&apos;t want it at all. Either is fine; we just need to know.</p>
          <div className="ik-choices" role="radiogroup" aria-label="AI use">
            {AI_CHOICES.map(c => (
              <button key={c.v} type="button" role="radio" aria-checked={form.ai === c.v}
                className={`ik-choice${form.ai === c.v ? ' on' : ''}`} onClick={() => set('ai', form.ai === c.v ? null : c.v)}>
                <b>{c.label}</b>
                <span>{c.hint}</span>
              </button>
            ))}
          </div>
          <Q k="ai_note" rows={1} label="Anything specific? (optional)" placeholder="e.g. AI backgrounds are fine, but never change the product itself" />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">7</span> What&apos;s coming up</h2>
          <Q k="upcoming" label="Launches, sales or events in the next few months"
            placeholder={"e.g. New SPF launch March 10\nMother's Day sale May 1-12"} />
          <div className="ik-slots">
            {slot({ kind: 'intake', title: 'Marketing calendar', hint: 'Got one? Upload it here, or paste a link below.' })}
          </div>
          <Q k="calendar_link" rows={1} label="Or a link to your calendar" placeholder="Google Sheet, Notion, Airtable…" />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">8</span> Store &amp; tech setup</h2>
          <p className="ik-help">So landing pages and offers go live without back-and-forth.</p>
          <Pick k="platform" label="What is your website built on?" choices={PLATFORMS} />
          <Q k="page_builder" rows={1} label="Theme or page builder" hint="If you know it, e.g. Dawn theme, Replo, GemPages, Shogun." />
          <Pick k="store_access" label="Can we get collaborator access to your store?" choices={STORE_ACCESS} />
          <Pick k="discounts_by" label="Who should create discount codes?" choices={DISCOUNTS_BY} />
          <Pick k="ads_by" label="Who runs your paid ads?" choices={ADS_BY} />
          <Q k="tech_notes" rows={2} label="Anything else technical we should know?"
            placeholder="e.g. Checkout is on ReCharge for subscriptions; legal must approve claims" />
        </section>

        <section className="ik-card">
          <h2><span className="ik-step">9</span> Who we work with</h2>
          <p className="ik-help">We&apos;ll work with you in a shared Slack channel. Tell us who should be in it, and who approves offers and creative.</p>
          {form.contacts.map((c, i) => (
            <div key={i} className="ik-contact">
              <div className="ik-contact-head">
                <b>{i === 0 ? 'Main contact' : `Person ${i + 1}`}</b>
                {i > 0 && <button type="button" className="ik-link" onClick={() => set('contacts', form.contacts.filter((_, j) => j !== i))}>Remove</button>}
              </div>
              <div className="ik-grid">
                {(['name', 'role', 'email', 'phone'] as const).map(k => (
                  <input key={k} aria-label={k} value={c[k]} type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}
                    placeholder={{ name: 'Name', role: 'Role, e.g. Founder, approves offers', email: 'Email', phone: 'Phone (optional)' }[k]}
                    onChange={e => set('contacts', form.contacts.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} />
                ))}
              </div>
            </div>
          ))}
          {form.contacts.length < 6 && (
            <button type="button" className="ik-link" onClick={() => set('contacts', [...form.contacts, { name: '', role: '', email: '', phone: '' }])}>+ Add another person</button>
          )}
        </section>

        <section className="ik-card">
          <Q k="anything_else" label="Anything else we should know?" />
        </section>

        <div className="ik-submit">
          <button className="ik-btn" onClick={submit} disabled={pending}>{pending ? 'Sending…' : submittedAt || done ? 'Send updates' : "I'm done, send it"}</button>
          <p>Your answers are already saved. This lets the team know you&apos;re finished.</p>
        </div>
      </main>
    </div>
    </FormCtx.Provider>
  )
}

function UploadSlot({
  token, kind, title, hint, badge, files, onAdded, onRemoved,
}: {
  token: string
  kind: string
  title: string
  hint: string
  badge?: string
  files: IntakeFile[]
  onAdded: (f: IntakeFile) => void
  onRemoved: (id: string) => void
}) {
  const [busy, setBusy] = useState<{ n: number; of: number; name: string } | null>(null)
  const [errs, setErrs] = useState<string[]>([])
  const [drag, setDrag] = useState(false)

  async function upload(list: File[]) {
    if (!list.length || busy) return
    const out: string[] = []
    const supabase = createClient()
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      setBusy({ n: i + 1, of: list.length, name: file.name })
      const type = resolveDocType(file)
      if (!type) { out.push(`${file.name}: this file type isn't accepted. Try PDF, PNG, JPG, SVG, AI/EPS, a font or a .zip.`); continue }
      if (file.size > MAX_BRAND_DOC_BYTES) { out.push(`${file.name}: over ${MAX_BRAND_DOC_BYTES / MB}MB. Paste a Drive or Dropbox link instead.`); continue }
      try {
        const signed = await createIntakeUploadUrl(token, kind, type, file.size)
        if (!signed.ok) { out.push(`${file.name}: ${signed.error}`); continue }
        // Re-wrapped so the bytes carry the type we resolved (see BrandDocuments).
        const body = file.type === type ? file : new File([file], file.name, { type })
        const { error } = await supabase.storage.from(BRAND_DOC_BUCKET)
          .uploadToSignedUrl(signed.path, signed.token, body, { contentType: type, cacheControl: '3600' })
        if (error) { out.push(`${file.name}: upload failed, try again.`); continue }
        const att = await attachIntakeFile(token, { path: signed.path, fileName: file.name, contentType: type, byteSize: file.size, kind })
        if (!att.ok) { out.push(`${file.name}: ${att.error}`); continue }
        onAdded({ id: att.id, file_name: file.name, kind, byte_size: file.size, from_client: true })
      } catch {
        out.push(`${file.name}: upload failed, try again.`)
      }
    }
    setBusy(null)
    setErrs(out)
  }

  async function remove(f: IntakeFile) {
    const r = await removeIntakeFile(token, f.id)
    if (r.ok) onRemoved(f.id)
    else setErrs([r.error])
  }

  return (
    <div className={`ik-slot${files.length ? ' has' : ''}${badge ? ' key' : ''}`}>
      <label
        className={`ik-drop${drag ? ' drag' : ''}${busy ? ' busy' : ''}`}
        onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); void upload(Array.from(e.dataTransfer.files ?? [])) }}
      >
        <input type="file" multiple accept={BRAND_DOC_ACCEPT} disabled={!!busy} hidden
          onChange={e => { const l = Array.from(e.target.files ?? []); e.target.value = ''; void upload(l) }} />
        <span className="ik-drop-icon" aria-hidden>{files.length ? '✓' : '+'}</span>
        <span className="ik-drop-text">
          <b>{title}{badge && !files.length && <em className="ik-badge">{badge}</em>}</b>
          <span>{busy ? `Uploading ${busy.name} (${busy.n} of ${busy.of})…` : hint}</span>
        </span>
      </label>
      {files.length > 0 && (
        <ul className="ik-files">
          {files.map(f => (
            <li key={f.id}>
              <span className="ik-file-name" title={f.file_name}>{f.file_name}</span>
              <span className="ik-file-size">{f.byte_size >= MB ? `${(f.byte_size / MB).toFixed(1)}MB` : `${Math.max(1, Math.round(f.byte_size / 1024))}KB`}</span>
              {f.from_client
                ? <button type="button" className="ik-link" onClick={() => remove(f)} aria-label={`Remove ${f.file_name}`}>Remove</button>
                : <span className="ik-file-size">on file</span>}
            </li>
          ))}
        </ul>
      )}
      {errs.map(e => <p key={e} className="ik-err">{e}</p>)}
    </div>
  )
}
