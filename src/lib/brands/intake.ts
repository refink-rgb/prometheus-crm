// Client intake: the one link a new client fills in so makers never start work
// without the brand guidelines, logo, product images, fonts, the AI answer,
// which products to push, what offers already ran, and how the store is set up.
//
// Only asks what the team cannot find on the client's website or in their
// brand guidelines. Safe for server and browser. The answers live in
// brands.intake_form (JSON, so the form re-opens filled in) and are mirrored
// into fields the rest of the app already reads: ai_sensitivity,
// intake_answers (readable text), brand_contacts and client_rules.

export interface IntakeContact {
  name: string
  role: string
  email: string
  phone: string
}

/** A question with fixed answers. Values are stored; labels are the client's words. */
export interface Choice { v: string; label: string }

export const PLATFORMS: Choice[] = [
  { v: 'shopify', label: 'Shopify' },
  { v: 'woocommerce', label: 'WooCommerce' },
  { v: 'bigcommerce', label: 'BigCommerce' },
  { v: 'other', label: 'Something else' },
]
export const STORE_ACCESS: Choice[] = [
  { v: 'will_invite', label: "Yes, we'll send a collaborator invite" },
  { v: 'has_access', label: 'You already have access' },
  { v: 'no', label: "No, we'll publish pages ourselves" },
]
export const DISCOUNTS_BY: Choice[] = [
  { v: 'agency', label: 'You can create them' },
  { v: 'client', label: "We'll create them" },
]
export const ADS_BY: Choice[] = [
  { v: 'in_house', label: 'We run them in-house' },
  { v: 'other_agency', label: 'Another agency runs them' },
  { v: 'agency', label: 'You run them' },
]

export interface IntakeForm {
  contacts: IntakeContact[]
  /** 0-3, the same scale as brands.ai_sensitivity. null = not answered. */
  ai: number | null
  ai_note: string
  /** Only asked when there are no brand guidelines. */
  colours: string
  fonts: string
  // Products and offers
  push_products: string
  avoid_products: string
  past_offers: string
  offer_limits: string
  // Customers and market
  reasons: string
  buyer: string
  frustrations: string
  competitors: string
  steer_clear: string
  proof: string
  // Beyond the guidelines
  brand_changes: string
  past_ads: string
  copy_donts: string
  design_donts: string
  /** How sales and campaigns differ from the everyday brand (fonts, colours, wording). */
  campaign_style: string
  // Video
  footage_link: string
  music: string
  // Coming up
  upcoming: string
  calendar_link: string
  // Technical setup
  platform: string
  page_builder: string
  store_access: string
  discounts_by: string
  ads_by: string
  tech_notes: string
  // Other
  asset_links: string
  /** What the client says is in asset_links: guidelines, logo, product_images, fonts. */
  asset_covers: string[]
  anything_else: string
}

const TEXT_FIELDS = [
  'ai_note', 'colours', 'fonts',
  'push_products', 'avoid_products', 'past_offers', 'offer_limits',
  'reasons', 'buyer', 'frustrations', 'competitors', 'steer_clear', 'proof',
  'brand_changes', 'past_ads', 'copy_donts', 'design_donts', 'campaign_style',
  'footage_link', 'music',
  'upcoming', 'calendar_link', 'page_builder', 'tech_notes',
  'asset_links', 'anything_else',
] as const

export const EMPTY_INTAKE: IntakeForm = {
  contacts: [{ name: '', role: '', email: '', phone: '' }],
  ai: null,
  platform: '', store_access: '', discounts_by: '', ads_by: '',
  ...(Object.fromEntries(TEXT_FIELDS.map(k => [k, ''])) as Record<typeof TEXT_FIELDS[number], string>),
  asset_covers: [],
}

/** File items a shared link can hold instead of an upload. */
export const LINKABLE = [
  { k: 'guidelines', label: 'Brand guidelines' },
  { k: 'logo', label: 'Logo files' },
  { k: 'product_images', label: 'Product images' },
  { k: 'fonts', label: 'Fonts' },
] as const

// Client-facing wording for brands.ai_sensitivity. Same scale as BrandBrief.
export const AI_CHOICES = [
  { v: 0, label: 'Fine with AI', hint: 'AI-generated images and copy are OK.' },
  { v: 1, label: 'Some AI is OK', hint: 'Fine within reason, as long as it looks real.' },
  { v: 2, label: 'Keep it minimal', hint: 'Prefer real photos of our products; AI only for small touches.' },
  { v: 3, label: 'No AI, please', hint: 'Only real photography and human-written copy.' },
] as const

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '')
const pick = (v: unknown, list: Choice[]) => (typeof v === 'string' && list.some(c => c.v === v) ? v : '')
const labelOf = (v: string, list: Choice[]) => list.find(c => c.v === v)?.label ?? ''

/** Whatever came back from the database or the browser, made into a form. */
export function normalizeIntake(raw: unknown): IntakeForm {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const contacts = Array.isArray(r.contacts)
    ? r.contacts.slice(0, 6).map(c => {
        const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
        return { name: str(o.name, 120), role: str(o.role, 120), email: str(o.email, 200), phone: str(o.phone, 60) }
      })
    : []
  const text = Object.fromEntries(TEXT_FIELDS.map(k => [k, str(r[k])])) as Record<typeof TEXT_FIELDS[number], string>
  // Answers saved by the first version of the form.
  if (!text.push_products && typeof r.products === 'string') text.push_products = str(r.products)
  if (!text.offer_limits && typeof r.offer === 'string') text.offer_limits = str(r.offer)
  if (!text.brand_changes && typeof r.voice === 'string') text.brand_changes = str(r.voice)
  return {
    ...text,
    contacts: contacts.length ? contacts : EMPTY_INTAKE.contacts,
    ai: typeof r.ai === 'number' && [0, 1, 2, 3].includes(r.ai) ? r.ai : null,
    platform: pick(r.platform, PLATFORMS),
    store_access: pick(r.store_access, STORE_ACCESS),
    discounts_by: pick(r.discounts_by, DISCOUNTS_BY),
    ads_by: pick(r.ads_by, ADS_BY),
    asset_covers: Array.isArray(r.asset_covers)
      ? LINKABLE.map(l => l.k).filter(k => (r.asset_covers as unknown[]).includes(k))
      : [],
  }
}

export const filledContacts = (f: IntakeForm) => f.contacts.filter(c => c.name.trim())

/** One rule per line, bullets stripped. Feeds client_rules on submit.
 *  A line ending in a colon ("Not permitted:", "Words to avoid:") is a heading
 *  the client wrote above their list, not a rule, so it is skipped. */
export function ruleLines(text: string): string[] {
  return text.split('\n')
    .map(l => l.replace(/^\s*([-*•–]|\d+[.)])\s*/, '').trim())
    .filter(l => l.length > 1 && !/[:：]$/.test(l))
    .slice(0, 30)
}

export interface IntakeQA { q: string; a: string }
export interface IntakeSection { title: string; items: IntakeQA[] }

/** Every question the form asks, grouped like the form, with the client's
 *  answer ('' when skipped). The team review view and intake_answers both read this. */
export function intakeSections(f: IntakeForm): IntakeSection[] {
  const groups: Array<[string, Array<[string, string]>]> = [
    ['Products & offers', [
      ['Products to push', f.push_products],
      ['Products to leave out', f.avoid_products],
      ['Offers tested before (results, conditions)', f.past_offers],
      ['Discount and offer limits', f.offer_limits],
    ]],
    ['Customers & market', [
      ['Why customers pick them', f.reasons],
      ['Main buyer (and any second type)', f.buyer],
      ['What frustrates buyers about the alternatives', f.frustrations],
      ['Competitors', f.competitors],
      ['Brands or tactics to steer clear of', f.steer_clear],
      ['Proof (reviews, results, press)', f.proof],
    ]],
    ['Beyond the guidelines', [
      ['How the brand has changed since the guidelines', f.brand_changes],
      ['Past ads that worked / did not', f.past_ads],
      ['Words, claims or phrases to avoid', f.copy_donts],
      ["Visual don'ts", f.design_donts],
      ['How sales and campaigns look and sound different', f.campaign_style],
      ['Colours (no guidelines)', f.colours],
      ['Fonts (no guidelines)', f.fonts],
    ]],
    ['Video & music', [
      ['Existing footage', f.footage_link],
      ['Music likes and dislikes', f.music],
    ]],
    ['AI', [
      ['How they feel about AI', [AI_CHOICES.find(c => c.v === f.ai)?.label ?? '', f.ai_note.trim()].filter(Boolean).join(' — ')],
    ]],
    ['Coming up', [
      ['Launches, sales, events', f.upcoming],
      ['Marketing calendar link', f.calendar_link],
    ]],
    ['Technical setup', [
      ['Website platform', labelOf(f.platform, PLATFORMS)],
      ['Theme / page builder', f.page_builder],
      ['Store access for us', labelOf(f.store_access, STORE_ACCESS)],
      ['Who creates discount codes', f.discounts_by === 'agency' ? 'We (the agency) do' : f.discounts_by === 'client' ? 'The client does' : ''],
      ['Who runs their ads', f.ads_by === 'agency' ? 'We (the agency) do' : labelOf(f.ads_by, ADS_BY)],
      ['Other technical notes', f.tech_notes],
    ]],
    ['People & files', [
      ['Points of contact', filledContacts(f).map(c => [c.name, c.role, c.email, c.phone].filter(Boolean).join(' · ')).join('\n')],
      ['Asset links (Drive, Dropbox, …)', f.asset_links],
      ['What the link holds', f.asset_links.trim() ? LINKABLE.filter(l => f.asset_covers.includes(l.k)).map(l => l.label).join(', ') : ''],
      ['Anything else', f.anything_else],
    ]],
  ]
  return groups.map(([title, qs]) => ({ title, items: qs.map(([q, a]) => ({ q, a: a.trim() })) }))
}

/** The readable version written to brands.intake_answers: answered questions only. */
export function intakeText(f: IntakeForm): string {
  return intakeSections(f)
    .map(({ title, items }) => {
      const answered = items.filter(i => i.a).map(i => `${i.q}\n${i.a}`)
      return answered.length ? `${title.toUpperCase()}\n\n${answered.join('\n\n')}` : ''
    })
    .filter(Boolean)
    .join('\n\n\n')
}

// ── Completeness ──────────────────────────────────────────────────────────

export type IntakeItemKey =
  | 'guidelines' | 'logo' | 'product_images' | 'fonts' | 'colours'
  | 'ai' | 'products' | 'offers' | 'market' | 'tech' | 'contact'

export interface IntakeItem {
  key: IntakeItemKey
  label: string
  done: boolean
  /** Why it counts as done, or what to do about it. */
  note?: string
  /** Done only through a shared link: the client is not asked again, but the
   *  team still has to file it in Prometheus. */
  linked?: boolean
}

export interface IntakeInputs {
  form: IntakeForm | null
  /** brand_documents.kind of every file on the brand. */
  docKinds: string[]
  hasGuidelineText: boolean
  aiSensitivity: number | null
  contactCount: number
  dna?: { primary_font?: string | null; primary_color?: string | null } | null
  /** Kinds covered by brand_asset_links rows the team added. */
  linkedKinds?: string[]
}

/** What makers need before they start, and whether the brand has it. */
export function intakeCompleteness(i: IntakeInputs): IntakeItem[] {
  const f = i.form
  const count = (k: string) => i.docKinds.filter(d => d === k).length
  const has = (...v: Array<string | undefined>) => v.some(x => !!x?.trim())
  const clientLink = !!f?.asset_links.trim()
  const linked = new Set([...(i.linkedKinds ?? []), ...(clientLink ? f!.asset_covers : [])])
  // Client pasted a link but didn't say what's in it: a hint, not done.
  const linkNote = clientLink && f!.asset_covers.length === 0 ? 'Client shared a link; check what is in it.' : undefined
  const LINKED_NOTE = 'In a shared link, not filed yet'
  const files = (k: IntakeItemKey, label: string): IntakeItem => {
    const n = count(k)
    if (n) return { key: k, label, done: true, note: `${n} file${n === 1 ? '' : 's'}` }
    if (linked.has(k)) return { key: k, label, done: true, linked: true, note: LINKED_NOTE }
    return { key: k, label, done: false, note: linkNote }
  }
  const guidelineFiles = count('guidelines')
  const fontFiles = count('fonts')
  const techAnswered = f ? [f.platform, f.store_access, f.discounts_by].filter(Boolean).length : 0
  return [
    guidelineFiles || !i.hasGuidelineText || linked.has('guidelines')
      ? files('guidelines', 'Brand guidelines')
      : { key: 'guidelines', label: 'Brand guidelines', done: true, note: 'Written, no file' },
    files('logo', 'Logo files'),
    files('product_images', 'Product images'),
    {
      key: 'fonts', label: 'Fonts',
      done: fontFiles > 0 || linked.has('fonts') || has(f?.fonts) || !!i.dna?.primary_font,
      linked: !fontFiles && linked.has('fonts') ? true : undefined,
      note: fontFiles ? `${fontFiles} font file${fontFiles === 1 ? '' : 's'}` : linked.has('fonts') ? LINKED_NOTE : has(f?.fonts) ? 'Named, no files' : i.dna?.primary_font ? 'From Brand DNA' : undefined,
    },
    {
      key: 'colours', label: 'Brand colours',
      done: has(f?.colours) || !!i.dna?.primary_color || guidelineFiles > 0 || linked.has('guidelines'),
      note: has(f?.colours) ? undefined : i.dna?.primary_color ? 'From Brand DNA' : guidelineFiles ? 'In the guidelines' : undefined,
    },
    { key: 'ai', label: 'OK with AI?', done: i.aiSensitivity != null, note: i.aiSensitivity != null ? AI_CHOICES.find(c => c.v === i.aiSensitivity)?.label : undefined },
    { key: 'products', label: 'Products to push / avoid', done: has(f?.push_products, f?.avoid_products) },
    { key: 'offers', label: 'Past offers & limits', done: has(f?.past_offers, f?.offer_limits) },
    { key: 'market', label: 'Customers & competitors', done: has(f?.reasons, f?.buyer, f?.competitors) },
    { key: 'tech', label: 'Store & discount setup', done: techAnswered >= 2, note: techAnswered === 1 ? 'Partly answered' : undefined },
    { key: 'contact', label: 'Point of contact', done: i.contactCount > 0 || (f ? filledContacts(f).length > 0 : false) },
  ]
}

export const missingItems = (items: IntakeItem[]) => items.filter(x => !x.done)

/** Everything a page needs to compute completeness, in one select each. */
export const INTAKE_BRAND_COLUMNS = 'id, name, intake_form, intake_submitted_at, intake_updated_at, ai_sensitivity, brand_guidelines'

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Completeness for one brand, for pages that do not already load its files
 *  and contacts (job and project pages). Tolerant of missing tables. */
export async function loadIntakeStatus(supabase: Db, brandId: string) {
  const [{ data: brand }, { data: docs }, { data: contacts }, { data: dna }] = await Promise.all([
    supabase.from('brands').select(INTAKE_BRAND_COLUMNS).eq('id', brandId).maybeSingle(),
    supabase.from('brand_documents').select('kind').eq('brand_id', brandId),
    supabase.from('brand_contacts').select('id').eq('brand_id', brandId),
    supabase.from('brand_dna').select('primary_font, primary_color').eq('brand_id', brandId).eq('is_active', true).maybeSingle(),
  ])
  const linkedKinds = await loadLinkedKinds(supabase, brandId)
  if (!brand) return null
  const b = brand as { name: string; intake_form: unknown; intake_submitted_at: string | null; ai_sensitivity: number | null; brand_guidelines: string | null }
  const items = intakeCompleteness({
    form: b.intake_form ? normalizeIntake(b.intake_form) : null,
    docKinds: ((docs ?? []) as Array<{ kind: string | null }>).map(d => d.kind ?? 'other'),
    hasGuidelineText: !!b.brand_guidelines?.trim(),
    aiSensitivity: b.ai_sensitivity,
    contactCount: (contacts ?? []).length,
    dna: dna as IntakeInputs['dna'],
    linkedKinds,
  })
  return { brandName: b.name, submittedAt: b.intake_submitted_at, items }
}

/** Every kind the brand's shared links cover. Empty if the table isn't there yet. */
export async function loadLinkedKinds(supabase: Db, brandId: string): Promise<string[]> {
  const { data, error } = await supabase.from('brand_asset_links').select('covers').eq('brand_id', brandId)
  if (error || !data) return []
  return (data as Array<{ covers: string[] | null }>).flatMap(r => r.covers ?? [])
}

/** Token shape check before any query: 32 url-safe characters. */
export const isIntakeToken = (t: string) => /^[A-Za-z0-9_-]{32}$/.test(t)
