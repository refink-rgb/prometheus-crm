// Offline persistence and rendering regression: node --test scripts/bfcm-missing.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

function load(file, imports = {}) {
  const sandboxModule = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, { module: sandboxModule, exports: sandboxModule.exports, structuredClone, console,
    require(name) { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name] },
  }, { filename: file })
  return sandboxModule.exports
}
const model = load('src/lib/bfcm/model.ts')
const Missing = load('src/components/bfcm/BfcmMissing.tsx', { 'react/jsx-runtime': jsx }).default
const brand = { slug: 'fictional-qa', name: 'Fictional QA', aliases: [], cap: 80, contract: { kind: 'grouped', static: 40, motion: 40 } }
const roundtrip = value => JSON.parse(JSON.stringify(value))

function fixture() {
  const state = model.createDraft(brand)
  state.notes = 'Existing notes'
  state.allocation = { textOffer: 5, newStatic: 15, refreshedStatic: 0, refreshedVideo: 0, motionGraphics: 40 }
  let row = { slug: brand.slug, version: 7, state: roundtrip(state), config: { brand } }
  let writes = 0
  const client = { async rpc(name, args) {
    assert.equal(name, 'bfcm_save_plan')
    assert.equal(args.p_slug, brand.slug)
    assert.equal(args.p_expected_version, row.version)
    row = { ...row, version: row.version + 1, state: roundtrip(args.p_state) }
    writes++
    return { data: row.version, error: null }
  } }
  const actions = load('src/lib/bfcm/actions.ts', {
    'node:crypto': {}, 'next/cache': { revalidatePath() {} },
    '@/lib/supabase/service': { createServiceClient: () => client }, './model': model,
    './content': { planMotionReferences: () => [] },
    './server': { requireBfcmEditor: async () => {}, loadPlan: async () => ({ row, brand, config: {}, draft: reload() }) },
  })
  function reload() { return model.parseStoredDraft(JSON.stringify({ ...row.state, history: [] }), brand.slug) }
  return { actions, reload, row: () => row, writes: () => writes }
}

test('Missing saves through the staff action and survives a fresh load; caps, notes and allocations stay intact', async () => {
  const f = fixture(), before = roundtrip(f.row())
  const missing = 'Brand guidelines\nProduct pictures <new pack>'
  const result = await f.actions.saveStaffBfcmPlan(brand.slug, { ...f.reload(), missing }, 7)
  assert.equal(result.ok, true)
  assert.equal(f.writes(), 1)
  assert.equal(f.reload().missing, missing)
  assert.equal(f.reload().notes, before.state.notes)
  assert.deepEqual(roundtrip(f.reload().allocation), before.state.allocation)
  assert.deepEqual(roundtrip(f.row().config), before.config)
  const html = renderToStaticMarkup(jsx.jsx(Missing, { value: f.reload().missing }))
  assert.match(html, /Missing: /)
  assert.match(html, /Brand guidelines\nProduct pictures &lt;new pack&gt;/)
  assert.match(html, /white-space:pre-wrap/)
  const stale = await f.actions.saveStaffBfcmPlan(brand.slug, { ...f.reload(), missing: 'stale' }, 7)
  assert.equal(stale.ok, false)
  assert.equal(f.writes(), 1)
  const cleared = await f.actions.saveStaffBfcmPlan(brand.slug, { ...f.reload(), missing: '' }, 8)
  assert.equal(cleared.ok, true)
  assert.equal(f.reload().missing, '')
  assert.equal(renderToStaticMarkup(jsx.jsx(Missing, { value: f.reload().missing })), '')
})

test('legacy plans default empty without adding fields to locked historical snapshots', () => {
  const draft = model.createDraft(brand)
  delete draft.missing
  const snapshot = roundtrip(draft)
  delete snapshot.history
  snapshot.status = 'locked'
  draft.history = [{ version: 1, lockedAt: '2026-10-30T12:00:00Z', snapshot }]
  const loaded = model.parseStoredDraft(JSON.stringify(draft), brand.slug)
  assert.equal(loaded.missing, '')
  assert.deepEqual(roundtrip(loaded.history[0].snapshot), snapshot)
  assert.equal(model.createDraft(brand).missing, '')
  assert.throws(() => model.updateDraft({ ...loaded, status: 'locked' }, { missing: 'changed' }))
})

test('invalid Missing values are rejected by the save action; empty footers stay hidden', async () => {
  const f = fixture()
  for (const missing of [null, 23, {}, 'x'.repeat(20_001)]) {
    const result = await f.actions.saveStaffBfcmPlan(brand.slug, { ...f.reload(), missing }, 7)
    assert.equal(result.ok, false)
  }
  assert.equal(f.writes(), 0)
  for (const value of [undefined, null, '', ' \n ', 23]) assert.equal(renderToStaticMarkup(jsx.jsx(Missing, { value })), '')
})
