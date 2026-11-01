// Brand profile: contacts, communication channel and client rules. Shared
// types and labels, safe for server and browser.
//
// A client rule is standing feedback: something the client told us that applies
// to everything we make for them ("never show the product on a white
// background"), not to one ad. Rules are shown wherever that kind of work is
// done, so the client never has to say it twice. Feedback about one piece stays
// on that piece's review.

export type RuleArea = 'general' | 'offers' | 'copy' | 'design' | 'landing_pages' | 'ads' | 'video'
export type RuleSource = 'review' | 'offer' | 'call' | 'email' | 'chat' | 'other'
export type Channel = 'email' | 'whatsapp' | 'slack' | 'phone' | 'sms' | 'other'
export type DocKind = 'guidelines' | 'contract' | 'intake' | 'other'

export interface ClientRule {
  id: string
  brand_id: string
  area: RuleArea
  rule: string
  why: string | null
  status: 'active' | 'retired'
  retired_reason: string | null
  retired_at: string | null
  last_confirmed_at: string
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface RuleMention {
  id: string
  rule_id: string
  brand_id: string
  source: RuleSource
  quote: string | null
  project_comment_id: string | null
  project_id: string | null
  offer_card_id: string | null
  said_on: string
  noted_by: string | null
  created_at: string
}

export interface RuleWithMentions extends ClientRule {
  mentions: RuleMention[]
}

export interface BrandContact {
  id: string
  brand_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  notes: string | null
  sort_order: number
}

export const RULE_AREAS: Record<RuleArea, { label: string; hint: string }> = {
  general:       { label: 'Everything',     hint: 'Applies to all work for this client' },
  offers:        { label: 'Offers',         hint: 'Discounts, bundles, what they will and will not run' },
  copy:          { label: 'Copy',           hint: 'Words, tone, claims, banned phrases' },
  design:        { label: 'Design',         hint: 'Colours, fonts, imagery, layout' },
  landing_pages: { label: 'Landing pages',  hint: 'Page structure, sections, links' },
  ads:           { label: 'Ads',            hint: 'Static ads and ad formats' },
  video:         { label: 'Video',          hint: 'UGC, motion, editing' },
}
export const RULE_AREA_ORDER: RuleArea[] = ['general', 'offers', 'copy', 'design', 'landing_pages', 'ads', 'video']

// Which rules each kind of work has to follow. 'general' is in every list.
export const RULES_FOR = {
  offers: ['general', 'offers'],
  landing_page: ['general', 'copy', 'design', 'landing_pages'],
  creatives: ['general', 'copy', 'design', 'ads', 'video'],
  all: RULE_AREA_ORDER,
} satisfies Record<string, RuleArea[]>
export type RuleSurface = keyof typeof RULES_FOR

export const RULE_SOURCES: Record<RuleSource, string> = {
  review: 'Review feedback',
  offer: 'Offer feedback',
  call: 'Call',
  email: 'Email',
  chat: 'Chat / Slack / WhatsApp',
  other: 'Other',
}

export const CHANNELS: Record<Channel, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  slack: 'Slack',
  phone: 'Phone call',
  sms: 'Text message',
  other: 'Other',
}

export const DOC_KINDS: Record<DocKind, string> = {
  guidelines: 'Brand guidelines',
  contract: 'Contracts',
  intake: 'Intake',
  other: 'Other files',
}

/** A rule nobody has confirmed in this long gets a "still true?" prompt. */
export const STALE_AFTER_DAYS = 180

export function isStale(rule: Pick<ClientRule, 'last_confirmed_at'>, now = Date.now()): boolean {
  return now - new Date(rule.last_confirmed_at).getTime() > STALE_AFTER_DAYS * 86_400_000
}

/** Times the client has told us this. 0 for rules written down without a source. */
export const timesTold = (r: RuleWithMentions) => r.mentions.length

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Active rules for a brand with every time the client said each one, oldest
 *  mention first. Tolerant of the migration not having run: an error is an
 *  empty list, never a crashed page. */
export async function loadRules(supabase: Db, brandId: string, { includeRetired = false } = {}): Promise<RuleWithMentions[]> {
  let q = supabase.from('client_rules').select('*, client_rule_mentions(*)').eq('brand_id', brandId)
  if (!includeRetired) q = q.eq('status', 'active')
  const { data } = await q.order('created_at', { ascending: true })
  return ((data ?? []) as Array<ClientRule & { client_rule_mentions: RuleMention[] }>).map(({ client_rule_mentions, ...r }) => ({
    ...r,
    mentions: [...(client_rule_mentions ?? [])].sort((a, b) => a.said_on.localeCompare(b.said_on)),
  }))
}
