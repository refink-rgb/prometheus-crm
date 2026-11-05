/** Pure planning domain. No database, API calls, credentials, or live imports. */
export const CATEGORIES = [
  { id: 'textOffer', label: 'Text offer' },
  { id: 'refreshedStatic', label: 'Refreshed static' },
  { id: 'newStatic', label: 'New static' },
  { id: 'refreshedVideo', label: 'Refreshed video' },
  { id: 'motionGraphics', label: 'Motion graphics' },
] as const
export type Category = typeof CATEGORIES[number]['id']
export type Allocation = Record<Category, number>
export type Brand = {
  slug: string; name: string; cap: number; aliases: string[]
  contract: { kind: 'exact'; quantities: Allocation } | { kind: 'grouped'; static: number; motion: number } | { kind: 'flexible' }
}
export type StageOffer = { offer: string; startDate: string; endDate: string; sitewide: boolean; included: string; hasExclusions: boolean; exclusions: string }
export type CopyLine = { id: string; text: string; source: 'BF anterior' | 'Recente' | 'Nova' }
export type Draft = {
  schemaVersion: 1; brandSlug: string; revision: number; copyRevision: number; status: 'draft' | 'locked'
  offers: { pre: StageOffer; bf: StageOffer }; prePercent: number; allocation: Allocation; allocationLocks: Category[]
  notes: string; missing?: string; fileIds: string[]; useClientCopy: boolean; noPreBf: boolean
  copies: CopyLine[]; approvedCopyIds: string[]; approvedCopiesRevision: number | null; motionIds: string[]; visibleMotionIds?: string[]; voiceover: boolean; sfx: boolean
  history: PlanVersion[]
}
export type PlanSnapshot = Omit<Draft, 'history'>
export type PlanVersion = { version: number; lockedAt: string; snapshot: PlanSnapshot }
export function suggestedAllocation(brand: Brand): Allocation {
  if (brand.contract.kind === 'exact') return { ...brand.contract.quantities }
  // Suggestions, NOT asserted contractual category quantities. Unknown contract values remain absent in contract.
  if (brand.contract.kind === 'grouped') return { textOffer: 0, refreshedStatic: 0, newStatic: brand.contract.static, refreshedVideo: 0, motionGraphics: brand.contract.motion }
  return { textOffer: 0, refreshedStatic: 0, newStatic: Math.round(brand.cap * .8), refreshedVideo: 0, motionGraphics: Math.round(brand.cap * .2) }
}
const blankOffer = (): StageOffer => ({ offer: '', startDate: '', endDate: '', sitewide: true, included: '', hasExclusions: false, exclusions: '' })
export function createDraft(brand: Brand, copies?: CopyLine[]): Draft {
  if (copies && (copies.length !== 30 || new Set(copies.map(c => c.id)).size !== 30)) throw new Error('Exactly 30 uniquely identified copy lines are required.')
  return { schemaVersion: 1, brandSlug: brand.slug, revision: 0, copyRevision: 0, status: 'draft', offers: { pre: blankOffer(), bf: blankOffer() }, prePercent: 30, allocation: suggestedAllocation(brand), allocationLocks: [], notes: '', missing: '', fileIds: [], useClientCopy: false, noPreBf: false, copies: copies ? structuredClone(copies) : Array.from({ length: 30 }, (_, i) => ({ id: `copy-${i + 1}`, text: '', source: 'Nova' as const })), approvedCopyIds: [], approvedCopiesRevision: null, motionIds: [], voiceover: false, sfx: false, history: [] }
}
/** Preserve the saved split while the pre-BF phase is temporarily disabled. */
export function effectivePrePercent(draft: Pick<Draft, 'noPreBf' | 'prePercent'>): number { return draft.noPreBf ? 0 : draft.prePercent }
export function stageQuantities(total: number, prePercent: number) { const pre = Math.round(total * prePercent / 100); return { pre, bf: total - pre } }
/** Category quantities are suggestions; only static/motion group totals are contracted. */
export function allocationLimits(brand: Brand): { static: number; motion: number } | null {
  if (brand.contract.kind === 'flexible') return null
  if (brand.contract.kind === 'grouped') return { static: brand.contract.static, motion: brand.contract.motion }
  const q = brand.contract.quantities
  return { static: q.textOffer + q.refreshedStatic + q.newStatic, motion: q.refreshedVideo + q.motionGraphics }
}
export function validateAllocation(brand: Brand, allocation: Allocation): string[] {
  const errors: string[] = []
  if (CATEGORIES.some(c => !Number.isSafeInteger(allocation[c.id]) || allocation[c.id] < 0)) return ['Quantities must be non-negative whole numbers.']
  const total = CATEGORIES.reduce((n, c) => n + allocation[c.id], 0)
  if (total !== brand.cap) errors.push(`Allocate exactly ${brand.cap} creatives; currently ${total}.`)
  const limits = allocationLimits(brand)
  if (limits) {
    if (allocation.textOffer + allocation.refreshedStatic + allocation.newStatic > limits.static) errors.push('Static allocation exceeds its contracted cap.')
    if (allocation.refreshedVideo + allocation.motionGraphics > limits.motion) errors.push('Motion allocation exceeds its contracted cap.')
  }
  return errors
}
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
export function validateOffers(offers: Draft['offers'], noPreBf = false): string[] {
  const stages: ('pre' | 'bf')[] = noPreBf ? ['bf'] : ['pre', 'bf']
  return stages.flatMap(stage => {
    const offer = offers[stage], label = stage === 'pre' ? 'Pre-BF' : 'Black Friday', errors: string[] = []
    if (!offer.offer.trim()) errors.push(`${label}: enter the planned offer.`)
    if (!validDate(offer.startDate) || !validDate(offer.endDate)) errors.push(`${label}: enter valid start and end dates.`)
    else if (offer.endDate < offer.startDate) errors.push(`${label}: end date must follow start date.`)
    if (!offer.sitewide && !offer.included.trim()) errors.push(`${label}: enter included products or collections.`)
    if (offer.hasExclusions && !offer.exclusions.trim()) errors.push(`${label}: enter exclusions or turn exclusions off.`)
    return errors
  })
}
export function validateCopies(copies: CopyLine[]): string[] {
  return copies.length === 30 && new Set(copies.map(c => c.id)).size === 30 && copies.every(c => c.text.trim() && ['BF anterior', 'Recente', 'Nova'].includes(c.source)) ? [] : ['Complete all 30 copy lines before approving.']
}
export function validateDraft(brand: Brand, draft: Draft): string[] {
  return [...(draft.brandSlug !== brand.slug ? ['Brand mismatch.'] : []), ...validateOffers(draft.offers, draft.noPreBf), ...validateAllocation(brand, draft.allocation), ...(draft.useClientCopy ? [] : validateCopies(draft.copies)), ...(!Number.isInteger(draft.prePercent) || draft.prePercent < 0 || draft.prePercent > 100 ? ['Stage allocation must be between 0 and 100%.'] : []), ...(!draft.useClientCopy && (draft.approvedCopiesRevision !== draft.copyRevision || draft.copies.some(c => !isCopyApproved(draft, c.id))) ? ['Explicitly approve the current 30 copy lines.'] : [])]
}
export type DraftPatch = Partial<Pick<Draft, 'offers' | 'prePercent' | 'allocation' | 'allocationLocks' | 'copies' | 'motionIds' | 'voiceover' | 'sfx' | 'notes' | 'missing' | 'useClientCopy' | 'noPreBf'>>
export function updateDraft(draft: Draft, patch: DraftPatch): Draft {
  if (draft.status === 'locked') throw new Error('Reopen this plan before editing.')
  if (patch.allocation && draft.allocationLocks.some(c => patch.allocation![c] !== draft.allocation[c])) throw new Error('Unlock the category before changing its quantity.')
  if (patch.copies) {
    if (draft.useClientCopy || patch.useClientCopy === true) throw new Error('Turn off client-provided copy before editing CRM copy lines.')
    for (const id of draft.approvedCopyIds) {
      const before = draft.copies.find(c => c.id === id), after = patch.copies.find(c => c.id === id)
      if (!before || !after || before.text !== after.text || before.source !== after.source) throw new Error('Explicitly unapprove this copy before editing or replacing it.')
    }
  }
  const invalidates = !!patch.copies || !!patch.offers || (patch.noPreBf !== undefined && patch.noPreBf !== draft.noPreBf)
  return { ...draft, ...structuredClone(patch), revision: draft.revision + 1, copyRevision: draft.copyRevision + (invalidates ? 1 : 0), approvedCopiesRevision: invalidates ? null : draft.approvedCopiesRevision }
}
export function isCopyApproved(draft: Draft, id: string): boolean { return draft.approvedCopyIds.includes(id) }
/** Only call for an explicit user approval/unapproval action, never from regeneration. */
export function setCopyApproval(draft: Draft, id: string, approved: boolean): Draft {
  if (draft.useClientCopy) throw new Error('Client-provided copy is selected. CRM copy approvals are unchanged.')
  if (draft.status === 'locked') throw new Error('Reopen this plan before changing copy approvals.')
  const copy = draft.copies.find(c => c.id === id)
  if (!copy) throw new Error('Copy not found.')
  if (approved && !copy.text.trim()) throw new Error('Enter copy text before approving it.')
  if (isCopyApproved(draft, id) === approved) return draft
  return { ...draft, revision: draft.revision + 1, approvedCopyIds: approved ? [...draft.approvedCopyIds, id] : draft.approvedCopyIds.filter(existing => existing !== id), approvedCopiesRevision: null }
}
/** Regeneration may only replace unapproved rows. Approved text/source/IDs are retained verbatim. */
export function mergeUnapprovedCopies(draft: Draft, generated: CopyLine[]): CopyLine[] {
  if (generated.length !== 30 || new Set(generated.map(c => c.id)).size !== 30 || generated.some(c => !draft.copies.some(existing => existing.id === c.id))) throw new Error('Generation must preserve all 30 copy IDs.')
  return draft.copies.map(copy => structuredClone(isCopyApproved(draft, copy.id) ? copy : generated.find(c => c.id === copy.id)!))
}
export function approveCopies(draft: Draft): Draft {
  if (draft.useClientCopy) throw new Error('Client-provided copy is selected. CRM copy approvals are not required.')
  if (draft.status === 'locked') throw new Error('Reopen this plan before editing.')
  const errors = validateCopies(draft.copies)
  if (errors.length) throw new Error(errors.join(' '))
  return { ...draft, revision: draft.revision + 1, approvedCopyIds: draft.copies.map(c => c.id), approvedCopiesRevision: draft.copyRevision }
}
export function lockDraft(brand: Brand, draft: Draft, confirmed: boolean, now = new Date().toISOString()): Draft {
  if (!confirmed) throw new Error('Explicit confirmation is required.')
  if (draft.status === 'locked') throw new Error('This plan is already locked.')
  const errors = validateDraft(brand, draft)
  if (errors.length) throw new Error(errors.join(' '))
  const { history, ...snapshot } = structuredClone({ ...draft, revision: draft.revision + 1, status: 'locked' as const })
  return { ...snapshot, history: [...history, { version: history.length + 1, lockedAt: now, snapshot }] }
}
export function reopenDraft(draft: Draft, confirmed: boolean): Draft {
  if (!confirmed) throw new Error('Explicit reopen confirmation is required.')
  if (draft.status !== 'locked') throw new Error('Only locked plans can be reopened.')
  return { ...structuredClone(draft), status: 'draft', revision: draft.revision + 1, approvedCopiesRevision: null }
}
/** Reject corrupted/cross-brand local storage rather than trusting JSON casts. */
export function parseStoredDraft(raw: string, brandSlug: string): Draft | null {
  try {
    const draft: unknown = JSON.parse(raw)
    if (!isDraftShape(draft, brandSlug)) return null
    // Upgrade only the missing approval field. Never reset existing edits, offers, or history.
    const upgrade = (snapshot: PlanSnapshot) => {
      if (!Object.prototype.hasOwnProperty.call(snapshot, 'useClientCopy')) Object.assign(snapshot, { useClientCopy: false })
      if (!Object.prototype.hasOwnProperty.call(snapshot, 'noPreBf')) Object.assign(snapshot, { noPreBf: false })
      if (!Object.prototype.hasOwnProperty.call(snapshot, 'fileIds')) Object.assign(snapshot, { fileIds: [] })
      if (!Object.prototype.hasOwnProperty.call(snapshot, 'notes')) Object.assign(snapshot, { notes: '' })
      if (!Object.prototype.hasOwnProperty.call(snapshot, 'approvedCopyIds')) Object.assign(snapshot, { approvedCopyIds: snapshot.approvedCopiesRevision === snapshot.copyRevision ? snapshot.copies.map(c => c.id) : [] })
    }
    upgrade(draft)
    // Default only the current draft; historical snapshots remain unchanged.
    if (!Object.prototype.hasOwnProperty.call(draft, 'missing')) draft.missing = ''
    for (const version of draft.history) upgrade(version.snapshot)
    return draft
  } catch { return null }
}
function isDraftShape(value: unknown, brandSlug: string, historyAllowed = true): value is Draft {
  if (!value || typeof value !== 'object') return false
  const d = value as Record<string, unknown>
  const isInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (d.schemaVersion !== 1 || d.brandSlug !== brandSlug || !['draft', 'locked'].includes(String(d.status)) || !isInt(d.revision) || !isInt(d.copyRevision)) return false
  if (typeof d.prePercent !== 'number' || !Number.isInteger(d.prePercent) || d.prePercent < 0 || d.prePercent > 100) return false
  if (d.approvedCopiesRevision !== null && (!isInt(d.approvedCopiesRevision) || d.approvedCopiesRevision !== d.copyRevision)) return false
  if ('fileIds' in d && (!Array.isArray(d.fileIds) || d.fileIds.length > 20 || d.fileIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) || new Set(d.fileIds).size !== d.fileIds.length)) return false
  if ('notes' in d && (typeof d.notes !== 'string' || d.notes.length > 20_000)) return false
  if ('missing' in d && (typeof d.missing !== 'string' || d.missing.length > 20_000)) return false
  if ('useClientCopy' in d && typeof d.useClientCopy !== 'boolean') return false
  if ('noPreBf' in d && typeof d.noPreBf !== 'boolean') return false
  if (typeof d.voiceover !== 'boolean' || typeof d.sfx !== 'boolean') return false
  if (!d.offers || typeof d.offers !== 'object') return false
  for (const stage of ['pre', 'bf']) {
    const o = (d.offers as Record<string, unknown>)[stage]
    if (!o || typeof o !== 'object') return false
    const offer = o as Record<string, unknown>
    if (['offer', 'startDate', 'endDate', 'included', 'exclusions'].some(k => typeof offer[k] !== 'string') || typeof offer.sitewide !== 'boolean' || typeof offer.hasExclusions !== 'boolean') return false
  }
  if (!d.allocation || typeof d.allocation !== 'object' || CATEGORIES.some(c => !isInt((d.allocation as Record<string, unknown>)[c.id]))) return false
  if (!Array.isArray(d.allocationLocks) || d.allocationLocks.some(k => !CATEGORIES.some(c => c.id === k))) return false
  if (!Array.isArray(d.motionIds) || d.motionIds.some(id => typeof id !== 'string') || new Set(d.motionIds).size !== d.motionIds.length) return false
  if ('visibleMotionIds' in d && (!Array.isArray(d.visibleMotionIds) || d.visibleMotionIds.some(id => typeof id !== 'string') || new Set(d.visibleMotionIds).size !== d.visibleMotionIds.length)) return false
  if (!Array.isArray(d.copies) || d.copies.length !== 30 || d.copies.some(c => !c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.text !== 'string' || !['BF anterior', 'Recente', 'Nova'].includes(c.source))) return false
  if (new Set(d.copies.map(c => c.id)).size !== 30) return false
  if ('approvedCopyIds' in d && (!Array.isArray(d.approvedCopyIds) || new Set(d.approvedCopyIds).size !== d.approvedCopyIds.length || d.approvedCopyIds.some(id => typeof id !== 'string' || !(d.copies as CopyLine[]).some(c => c.id === id)))) return false
  if (historyAllowed) {
    if (!Array.isArray(d.history) || d.history.some((v, index) => !v || typeof v !== 'object' || v.version !== index + 1 || typeof v.lockedAt !== 'string' || !isDraftShape(v.snapshot, brandSlug, false))) return false
  } else if ('history' in d) return false
  return true
}
