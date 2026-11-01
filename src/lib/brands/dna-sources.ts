// What a Brand DNA build reads. Brand DNA is the one reference for a client:
// everything here is digested into it once, and the rest of the app reads the
// DNA rather than the raw material. Each source carries a stamp, so the page can
// say when something new has arrived and a rebuild is worth its AI credits.
// Safe for server and browser.

import type { BrandComment, BrandDocument } from '@/lib/types'
import type { ClientRule } from './profile'

export interface DnaSource {
  key: string
  label: string
  stamp: string
}

export interface DnaSourceInput {
  website: string | null
  brand_guidelines: string | null
  brand_notes: string | null
  intake_answers?: string | null
  onboarding_transcript: string | null
  documents: Pick<BrandDocument, 'id' | 'file_name' | 'kind'>[]
  contracts: { id: string; title: string; updated_at: string }[]
  rules: Pick<ClientRule, 'id' | 'status' | 'updated_at'>[]
  comments: Pick<BrandComment, 'id'>[]
}

// Which file types a build reads. Other files (price lists, research) are kept
// but not parsed: they would spend credits on detail the DNA does not need.
export const DNA_DOC_KINDS = ['guidelines', 'intake'] as const

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return `${text.length}.${h.toString(36)}`
}

export function dnaSources(input: DnaSourceInput): DnaSource[] {
  const out: DnaSource[] = []
  const add = (key: string, label: string, stamp: string) => out.push({ key, label, stamp })
  if (input.website) add('website', 'Website', input.website)
  for (const d of input.documents) {
    if (d.kind === 'guidelines' || d.kind === 'intake') add(`doc:${d.id}`, d.file_name, d.id)
  }
  if (input.brand_guidelines?.trim()) add('guidelines', 'Pasted guidelines', hash(input.brand_guidelines))
  if (input.onboarding_transcript?.trim()) add('call', 'Onboarding call', hash(input.onboarding_transcript))
  if (input.intake_answers?.trim()) add('intake', 'Intake answers', hash(input.intake_answers))
  for (const c of input.contracts) add(`contract:${c.id}`, `Contract: ${c.title}`, c.updated_at)
  const rules = input.rules.filter(r => r.status === 'active')
  if (rules.length) add('rules', `Client feedback (${rules.length})`, hash(rules.map(r => `${r.id}${r.updated_at}`).sort().join()))
  if (input.brand_notes?.trim()) add('notes', 'Internal notes', hash(input.brand_notes))
  if (input.comments.length) add('thread', `Team notes (${input.comments.length})`, hash(input.comments.map(c => c.id).sort().join()))
  return out
}

/** Labels of the sources that are new or changed since the build that made `built`. */
export function newSinceBuild(current: DnaSource[], built: DnaSource[] | null): string[] {
  const known = new Map((built ?? []).map(s => [s.key, s.stamp]))
  return current.filter(s => known.get(s.key) !== s.stamp).map(s => s.label)
}
