import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createDraft, updateDraft, approveCopies, lockDraft, reopenDraft, validateAllocation, validateOffers, stageQuantities, parseStoredDraft, allocationLimits, setCopyApproval, isCopyApproved, mergeUnapprovedCopies, effectivePrePercent, validateDraft, draftWarnings, type Brand, type Draft } from './model'
const brand: Brand = { slug: 'example-brand', name: 'Example Brand', cap: 100, aliases: [], contract: { kind: 'exact', quantities: { textOffer: 20, refreshedStatic: 20, newStatic: 20, refreshedVideo: 20, motionGraphics: 20 } } }
const groupedBrand: Brand = { slug: 'example-grouped', name: 'Example Grouped Brand', cap: 100, aliases: [], contract: { kind: 'grouped', static: 70, motion: 30 } }
const flexibleBrand: Brand = { slug: 'example-flexible', name: 'Example Flexible Brand', cap: 100, aliases: [], contract: { kind: 'flexible' } }
function completed(): Draft {
  let draft = createDraft(brand)
  const offer = { offer: 'Current approved offer', startDate: '2026-11-01', endDate: '2026-11-30', sitewide: true, included: '', hasExclusions: false, exclusions: '' }
  draft = updateDraft(draft, { offers: { pre: { ...offer }, bf: { ...offer } }, copies: draft.copies.map((c, i) => ({ ...c, text: `Copy ${i + 1}` })), motionIds: ['validated-reference'] })
  return approveCopies(draft)
}
test('30 blank Nova lines are never implicitly approved', () => {
  const draft = createDraft(brand)
  assert.equal(draft.copies.length, 30); assert.ok(draft.copies.every(c => c.source === 'Nova' && !c.text)); assert.equal(draft.approvedCopiesRevision, null)
  assert.throws(() => approveCopies(draft))
  assert.throws(() => createDraft(brand, []))
})
test('allocation respects exact and grouped caps and integer totals', () => {
  for (const b of [brand, groupedBrand, flexibleBrand]) assert.deepEqual(validateAllocation(b, createDraft(b).allocation), [])
  const a = createDraft(brand).allocation
  assert.deepEqual(validateAllocation(brand, { ...a, textOffer: 21, newStatic: 19 }), [])
  assert.deepEqual(validateAllocation(brand, { ...a, refreshedVideo: 0, motionGraphics: 40 }), [])
  assert.ok(validateAllocation(brand, { ...a, newStatic: 19, motionGraphics: 21 }).length)
  assert.deepEqual(allocationLimits(brand), { static: 60, motion: 40 })
  assert.ok(validateAllocation(brand, { ...a, textOffer: -1 }).length)
  assert.ok(validateAllocation(brand, { ...a, textOffer: NaN }).length)
  const grouped = createDraft(groupedBrand).allocation
  assert.ok(validateAllocation(groupedBrand, { ...grouped, newStatic: 69, motionGraphics: 31 }).length)
  assert.deepEqual(stageQuantities(301, 30), { pre: 90, bf: 211 })
})
test('category locks are enforced in domain, not only disabled inputs', () => {
  const draft = updateDraft(createDraft(brand), { allocationLocks: ['textOffer'] })
  assert.throws(() => updateDraft(draft, { allocation: { ...draft.allocation, textOffer: 19 } }))
})
test('both offer stages require dates/inclusions/conditional exclusions', () => {
  const draft = completed()
  assert.deepEqual(validateOffers(draft.offers), [])
  assert.ok(validateOffers({ ...draft.offers, pre: { ...draft.offers.pre, offer: '' } }).length)
  assert.ok(validateOffers({ ...draft.offers, bf: { ...draft.offers.bf, startDate: '2026-02-30' } }).length)
  assert.ok(validateOffers({ ...draft.offers, bf: { ...draft.offers.bf, sitewide: false } }).length)
  assert.ok(validateOffers({ ...draft.offers, bf: { ...draft.offers.bf, hasExclusions: true } }).length)
})
test('explicit approval invalidates on copy or current-offer changes', () => {
  const draft = completed()
  assert.equal(draft.approvedCopiesRevision, draft.copyRevision)
  assert.equal(updateDraft(draft, { sfx: true }).approvedCopiesRevision, draft.copyRevision)
  assert.equal(updateDraft(draft, { copies: draft.copies }).approvedCopiesRevision, null)
  assert.equal(updateDraft(draft, { offers: draft.offers }).approvedCopiesRevision, null)
})
test('lock and reopen require explicit confirmations and retain immutable version snapshots', () => {
  const draft = completed()
  assert.throws(() => lockDraft(brand, draft, false))
  const locked = lockDraft(brand, draft, true, '2026-10-28T00:00:00Z')
  assert.equal(locked.status, 'locked'); assert.equal(locked.history.length, 1)
  assert.throws(() => updateDraft(locked, { sfx: true })); assert.throws(() => reopenDraft(locked, false))
  const reopened = reopenDraft(locked, true)
  assert.equal(reopened.approvedCopiesRevision, null)
  reopened.copies[0].text = 'changed'
  assert.notEqual(locked.history[0].snapshot.copies[0].text, 'changed')
  const relocked = lockDraft(brand, approveCopies(reopened), true)
  assert.equal(relocked.history.length, 2); assert.equal(relocked.history[1].version, 2)
})
test('stored drafts reject corruption and cross-client loading', () => {
  const draft = completed()
  assert.deepEqual(parseStoredDraft(JSON.stringify(draft), brand.slug), draft)
  assert.equal(parseStoredDraft(JSON.stringify(draft), 'other-example-brand'), null)
  assert.equal(parseStoredDraft('{broken', brand.slug), null)
  assert.equal(parseStoredDraft(JSON.stringify({ ...draft, copies: [] }), brand.slug), null)
  assert.equal(parseStoredDraft(JSON.stringify({ ...draft, approvedCopiesRevision: 900 }), brand.slug), null)
  const locked = lockDraft(brand, draft, true)
  assert.deepEqual(parseStoredDraft(JSON.stringify(locked), brand.slug), locked)
})

test('approved copies cannot be edited, replaced or removed until explicitly unapproved', () => {
  const draft = completed(), id = draft.copies[0].id
  assert.equal(isCopyApproved(draft, id), true)
  const copies = draft.copies.map(c => c.id === id ? { ...c, text: 'Changed copy' } : c)
  assert.throws(() => updateDraft(draft, { copies }), /unapprove/)
  assert.throws(() => updateDraft(draft, { copies: draft.copies.slice(1) }), /unapprove/)
  const unapproved = setCopyApproval(draft, id, false)
  const edited = updateDraft(unapproved, { copies })
  assert.equal(edited.approvedCopyIds.length, 29)
  assert.equal(isCopyApproved(edited, id), false)
  assert.equal(edited.approvedCopiesRevision, null)
  assert.equal(setCopyApproval(edited, id, true).approvedCopyIds.length, 30)
})
test('regeneration retains approved rows verbatim and replaces only unapproved rows', () => {
  const draft = setCopyApproval(completed(), 'copy-2', false)
  const generated = draft.copies.map(c => ({ ...c, text: `Generated ${c.id}` }))
  const merged = mergeUnapprovedCopies(draft, generated)
  assert.deepEqual(merged[0], draft.copies[0])
  assert.equal(merged[1].text, 'Generated copy-2')
  assert.deepEqual(updateDraft(draft, { copies: merged }).approvedCopyIds, draft.approvedCopyIds)
  assert.throws(() => mergeUnapprovedCopies(draft, []))
})
test('offer edits and explicit reopen retain per-copy approvals without silently unapproving rows', () => {
  const draft = completed()
  assert.deepEqual(updateDraft(draft, { offers: draft.offers }).approvedCopyIds, draft.approvedCopyIds)
  assert.deepEqual(reopenDraft(lockDraft(brand, draft, true), true).approvedCopyIds, draft.approvedCopyIds)
  assert.throws(() => setCopyApproval(lockDraft(brand, draft, true), 'copy-1', false))
})
test('legacy whole-copy approvals upgrade while every other field and history is preserved', () => {
  const draft = completed()
  const locked = lockDraft(brand, draft, true)
  const legacy = JSON.parse(JSON.stringify(locked))
  delete legacy.approvedCopyIds
  delete legacy.history[0].snapshot.approvedCopyIds
  const recovered = parseStoredDraft(JSON.stringify(legacy), brand.slug)!
  assert.equal(recovered.approvedCopyIds.length, 30)
  assert.equal(recovered.history[0].snapshot.approvedCopyIds.length, 30)
  assert.deepEqual(recovered, locked)
  const unapprovedLegacy = JSON.parse(JSON.stringify(createDraft(brand)))
  delete unapprovedLegacy.approvedCopyIds
  assert.deepEqual(parseStoredDraft(JSON.stringify(unapprovedLegacy), brand.slug)!.approvedCopyIds, [])
  assert.equal(parseStoredDraft(JSON.stringify({ ...draft, approvedCopyIds: ['missing-id'] }), brand.slug), null)
  assert.equal(parseStoredDraft(JSON.stringify({ ...draft, approvedCopyIds: ['copy-1', 'copy-1'] }), brand.slug), null)
})

test('optional visible reference IDs preserve backwards compatibility and reject duplicates', () => {
  const draft = completed()
  assert.deepEqual(parseStoredDraft(JSON.stringify({ ...draft, visibleMotionIds: ['reference-a', 'reference-b'] }), brand.slug)?.visibleMotionIds, ['reference-a', 'reference-b'])
  assert.equal(parseStoredDraft(JSON.stringify({ ...draft, visibleMotionIds: ['reference-a', 'reference-a'] }), brand.slug), null)
})

test('shared notes persist across copies, motion and lock history without changing approval', () => {
  const draft = completed()
  const next = updateDraft(draft, { notes: 'Shared planning notes' })
  assert.equal(next.copyRevision, draft.copyRevision)
  assert.equal(next.approvedCopiesRevision, draft.approvedCopiesRevision)
  assert.equal(updateDraft(next, { sfx: true }).notes, 'Shared planning notes')
  const locked = lockDraft(brand, next, true)
  assert.equal(locked.history[0].snapshot.notes, 'Shared planning notes')
  assert.throws(() => updateDraft(locked, { notes: 'Changed' }))
})
test('legacy notes and attachments initialize only absent fields; invalid payloads rejected', () => {
  const original = completed(), legacy = JSON.parse(JSON.stringify(original))
  delete legacy.notes; delete legacy.fileIds
  assert.deepEqual(parseStoredDraft(JSON.stringify(legacy), brand.slug), original)
  assert.equal(parseStoredDraft(JSON.stringify({ ...original, notes: 'x'.repeat(20_001) }), brand.slug), null)
  assert.equal(parseStoredDraft(JSON.stringify({ ...original, fileIds: ['../other-plan'] }), brand.slug), null)
  const fileIds = ['12345678-1234-1234-1234-123456789abc']
  assert.deepEqual(parseStoredDraft(JSON.stringify({ ...original, fileIds }), brand.slug)?.fileIds, fileIds)
})

for (const useClientCopy of [false, true]) for (const noPreBf of [false, true]) {
  test(`planning mode combination clientCopy=${useClientCopy}, noPreBf=${noPreBf}`, () => {
    const done = completed()
    let draft = updateDraft(createDraft(brand), {
      offers: { pre: noPreBf ? createDraft(brand).offers.pre : done.offers.pre, bf: done.offers.bf },
      motionIds: done.motionIds, useClientCopy, noPreBf,
    })
    if (!useClientCopy) {
      assert.ok(draftWarnings(draft).some(e => e.includes('copy')))
      assert.deepEqual(validateDraft(brand, draft), [])
      draft = approveCopies(updateDraft(draft, { copies: done.copies }))
    }
    assert.deepEqual(validateDraft(brand, draft), [])
    assert.deepEqual(draftWarnings(draft), [])
    const locked = lockDraft(brand, draft, true)
    assert.equal(locked.status, 'locked')
    assert.equal(locked.history[0].snapshot.useClientCopy, useClientCopy)
    assert.equal(locked.history[0].snapshot.noPreBf, noPreBf)
    assert.equal(effectivePrePercent(draft), noPreBf ? 0 : 30)
    if (useClientCopy) {
      assert.deepEqual(locked.approvedCopyIds, [])
      assert.equal(locked.approvedCopiesRevision, null)
      assert.ok(locked.copies.every(c => c.text === ''))
    }
  })
}
test('client-copy toggle preserves every row and approval, without approving or editing CRM copy', () => {
  for (const initial of [createDraft(brand), completed()]) {
    const enabled = updateDraft(initial, { useClientCopy: true })
    assert.deepEqual(enabled.copies, initial.copies)
    assert.deepEqual(enabled.approvedCopyIds, initial.approvedCopyIds)
    assert.equal(enabled.approvedCopiesRevision, initial.approvedCopiesRevision)
    assert.throws(() => approveCopies(enabled), /Client-provided/)
    assert.throws(() => setCopyApproval(enabled, enabled.copies[0].id, true), /Client-provided/)
    assert.throws(() => updateDraft(enabled, { copies: enabled.copies }), /client-provided/)
    const disabled = updateDraft(enabled, { useClientCopy: false })
    assert.deepEqual(disabled.copies, initial.copies)
    assert.deepEqual(disabled.approvedCopyIds, initial.approvedCopyIds)
    assert.equal(disabled.approvedCopiesRevision, initial.approvedCopiesRevision)
  }
  const draft = completed()
  const bypass = updateDraft({ ...draft, approvedCopyIds: [], approvedCopiesRevision: null }, { useClientCopy: true })
  assert.deepEqual(draftWarnings(bypass), [])
  assert.ok(draftWarnings(updateDraft(bypass, { useClientCopy: false })).some(e => e.includes('approve')))
})
test('no-pre-BF preserves disabled inputs and restores split on reenable', () => {
  const original = updateDraft(completed(), { prePercent: 43 })
  const disabled = updateDraft(original, { noPreBf: true })
  assert.deepEqual(disabled.offers, original.offers)
  assert.equal(disabled.prePercent, 43)
  assert.deepEqual(stageQuantities(brand.cap, effectivePrePercent(disabled)), { pre: 0, bf: 100 })
  assert.equal(disabled.approvedCopiesRevision, null)
  assert.deepEqual(disabled.approvedCopyIds, original.approvedCopyIds)
  const reenabled = updateDraft(disabled, { noPreBf: false })
  assert.deepEqual(reenabled.offers, original.offers)
  assert.equal(effectivePrePercent(reenabled), 43)
  const incompletePre = { ...original.offers, pre: createDraft(brand).offers.pre }
  assert.deepEqual(validateOffers(incompletePre, true), [])
  assert.ok(validateOffers(incompletePre, false).length)
  assert.ok(validateOffers({ ...incompletePre, bf: createDraft(brand).offers.bf }, true).length)
})
test('mode flags default only when missing, including history; explicit nonbooleans rejected', () => {
  const original = lockDraft(brand, completed(), true)
  const legacy = JSON.parse(JSON.stringify(original))
  delete legacy.useClientCopy; delete legacy.noPreBf
  delete legacy.history[0].snapshot.useClientCopy; delete legacy.history[0].snapshot.noPreBf
  assert.deepEqual(parseStoredDraft(JSON.stringify(legacy), brand.slug), original)
  for (const key of ['useClientCopy', 'noPreBf']) {
    for (const value of ['true', 'false', 1, 0, null, [], {}]) {
      assert.equal(parseStoredDraft(JSON.stringify({ ...original, [key]: value }), brand.slug), null)
      const badHistory = structuredClone(original)
      Object.assign(badHistory.history[0].snapshot, { [key]: value })
      assert.equal(parseStoredDraft(JSON.stringify(badHistory), brand.slug), null)
    }
    assert.throws(() => updateDraft(original, { [key]: true }), /Reopen/)
  }
})

test('motion references are optional across copy and promotion modes', () => {
  for (const useClientCopy of [false, true]) for (const noPreBf of [false, true]) {
    const draft = { ...completed(), useClientCopy, noPreBf, motionIds: [] }
    if (useClientCopy) { draft.approvedCopyIds = []; draft.approvedCopiesRevision = null }
    if (noPreBf) draft.offers.pre = createDraft(brand).offers.pre
    assert.deepEqual(validateDraft(brand, draft), [])
    const locked = lockDraft(brand, draft, true)
    assert.deepEqual(locked.motionIds, [])
    assert.deepEqual(locked.history[0].snapshot.motionIds, [])
    const invalid = { ...draft, offers: { ...draft.offers, bf: createDraft(brand).offers.bf } }
    assert.ok(draftWarnings(invalid).some(e => e.includes('Black Friday')))
    assert.equal(lockDraft(brand, invalid, true).status, 'locked')
  }
  const selected = completed()
  assert.deepEqual(lockDraft(brand, selected, true).motionIds, selected.motionIds)
})

test('incomplete offers and copy are optional warnings; integrity checks still block confirming', () => {
  const blank = createDraft(brand)
  const warnings = draftWarnings(blank)
  for (const expected of ['Black Friday: enter the planned offer.', 'Black Friday: enter valid start and end dates.', 'Complete all 30 copy lines before approving.', 'Explicitly approve the current 30 copy lines.']) assert.ok(warnings.includes(expected), expected)
  assert.deepEqual(validateDraft(brand, blank), [])
  const locked = lockDraft(brand, blank, true)
  assert.equal(locked.status, 'locked')
  assert.equal(locked.history.length, 1)
  assert.throws(() => lockDraft(brand, blank, false), /confirmation/)
  assert.throws(() => lockDraft(brand, { ...blank, allocation: { ...blank.allocation, newStatic: blank.allocation.newStatic + 1 } }, true), /Allocate exactly/)
  assert.throws(() => lockDraft(brand, { ...blank, brandSlug: 'other' }, true), /Brand mismatch/)
})
