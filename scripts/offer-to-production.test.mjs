// Offline regression tests. No service client, credentials, or network access.
// Run: node --test scripts/offer-to-production.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = process.env.PROMETHEUS_TEST_SOURCE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function load(relative, imports = {}) {
  const filename = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(code, {
    exports: sandboxModule.exports, module: sandboxModule,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`)
      return imports[name]
    },
    process: { env: {} }, console: { error() {} },
  }, { filename })
  return sandboxModule.exports
}
const codes = load('src/lib/moment-code.ts')
const types = load('src/lib/types.ts')
const duplicate = { code: '23505', message: 'duplicate key violates unique constraint "uq_projects_moment_code"' }

function fixture(offers, options = {}) {
  const projects = []
  const attempts = []
  const client = {
    from(table) {
      let operation = 'select', row
      const filters = {}
      const query = {
        select() { return query },
        eq(k, v) { filters[k] = v; return query },
        limit() { return query },
        insert(value) { operation = 'insert'; row = value; return query },
        update(value) { operation = 'update'; row = value; return query },
        single: execute, maybeSingle: execute,
        then(resolve, reject) { return execute().then(resolve, reject) },
      }
      async function execute() {
        if (table === 'offer_cards') {
          const offer = offers.find(o => o.id === filters.id)
          if (operation === 'update') {
            if (options.linkError) return { error: options.linkError }
            Object.assign(offer, row)
          }
          return { data: { ...offer }, error: null }
        }
        if (table === 'journeys') return { data: { id: 'journey' }, error: null }
        assert.equal(table, 'projects')
        if (operation === 'select') {
          if (options.lookupError) return { error: options.lookupError }
          return { data: projects.find(p => p.source_offer_card_id === filters.source_offer_card_id) || null, error: null }
        }
        attempts.push(row)
        if (options.insertError) return { error: options.insertError }
        if (options.exhaust || projects.some(p => p.moment_code === row.moment_code)) return { error: duplicate }
        const project = { ...row, id: `project-${projects.length + 1}` }
        projects.push(project)
        return { data: { id: project.id }, error: null }
      }
      return query
    },
  }
  const { createProductionCardFromOffer: create } = load('src/lib/offer-to-production.ts', {
    './supabase/service': { createServiceClient: () => client },
    './types': types, './moment-code': codes,
  })
  return { create, projects, attempts, options }
}
function offer(slot, month = '2026-10-01', brand = 'Roobi', id = `${brand}-${month}-${slot}`) {
  return { id, moment_slot: slot, target_month: month, brands: { id: brand, name: brand },
    derived_production_card_id: null, offer: 'Preserved offer', competitor_reference: 'Preserved reference' }
}

test('reproduces the original October M2/M3 collision for both affected brands', () => {
  for (const [brand, expected] of [['Roobi', 'ROO2MM311026'], ['Viante', 'VIO2MM311026']]) {
    for (const slot of [2, 3]) assert.equal(codes.momentCode(brand, `October 2026 · M${slot} Moment`, '2026-10-31'), expected)
  }
})

test('M1/M2 retain historical codes; M3/M4/M10 get distinct codes with unchanged data', async () => {
  for (const brand of ['Roobi', 'Viante']) {
    const offers = [1, 2, 3, 4, 10].map(slot => offer(slot, '2026-10-01', brand))
    const f = fixture(offers)
    for (const o of offers) await f.create(o.id, 'actor')
    const prefix = brand === 'Roobi' ? 'RO' : 'VI'
    assert.deepEqual(f.projects.map(p => p.moment_code), [
      `${prefix}O2MM151026`, `${prefix}O2MM311026`, `${prefix}O2MMM3311026`,
      `${prefix}O2MMM4311026`, `${prefix}O2MMM10311026`,
    ])
    for (const [i, p] of f.projects.entries()) {
      assert.equal(offers[i].derived_production_card_id, p.id)
      assert.equal(p.source_offer_card_id, offers[i].id)
      assert.equal(p.offer, 'Preserved offer')
      assert.equal(p.competitor_reference, 'Preserved reference')
      assert.equal(p.created_by, 'actor')
      assert.match(p.moment_code, /^[A-Z0-9$%]{4,40}$/)
    }
  }
})

test('repeated offers in the same slot allocate versions without touching existing codes', async () => {
  const offers = [1, 2, 3, 4].map(n => offer(3, '2026-10-01', 'Roobi', `offer-${n}`))
  const f = fixture(offers)
  for (const o of offers) await f.create(o.id, null)
  assert.deepEqual(f.projects.map(p => p.moment_code), ['ROO2MM311026', 'ROO2MMM3311026', 'ROO2MMM3A311026', 'ROO2MMM3B311026'])
})

test('sequential retry preserves existing code and heals missing reverse pointer', async () => {
  const o = offer(3), f = fixture([o])
  const first = await f.create(o.id, null)
  o.derived_production_card_id = null
  f.projects[0].moment_code = 'EXISTINGADCODE'
  const retry = await f.create(o.id, null)
  assert.equal(retry.reason, 'already_exists')
  assert.equal(retry.projectId, first.projectId)
  assert.equal(o.derived_production_card_id, first.projectId)
  assert.equal(f.projects.length, 1)
  assert.equal(f.projects[0].moment_code, 'EXISTINGADCODE')
})

test('concurrent retries create one project including when the legacy code is occupied', async () => {
  for (const occupied of [false, true]) {
    const a = offer(2), b = offer(3), f = fixture([a, b])
    if (occupied) await f.create(a.id, null)
    const results = await Promise.all([f.create(b.id, null), f.create(b.id, null)])
    assert.equal(results[0].projectId, results[1].projectId)
    assert.equal(f.projects.filter(p => p.source_offer_card_id === b.id).length, 1)
    assert.equal(b.derived_production_card_id, results[0].projectId)
  }
})

test('calendar boundaries: common/leap February, April, December and January', async () => {
  for (const [month, end] of [['2026-02-01', '28'], ['2028-02-01', '29'], ['2026-04-01', '30'], ['2026-12-01', '31'], ['2027-01-01', '31']]) {
    const offers = [1, 2, 3].map(slot => offer(slot, month)), f = fixture(offers)
    for (const o of offers) await f.create(o.id, null)
    assert.deepEqual(f.projects.map(p => p.due_date), ['15', end, end].map(d => `${month.slice(0, 7)}-${d}`))
    assert.equal(new Set(f.projects.map(p => p.moment_code)).size, 3)
  }
})

test('unrelated unique violations and database errors are surfaced without retry', async () => {
  for (const error of [{ code: '23505', message: 'other_unique_index' }, { code: '23514', message: 'check constraint' }]) {
    const o = offer(3), f = fixture([o], { insertError: error })
    await assert.rejects(f.create(o.id, null), new RegExp(error.message))
    assert.equal(f.attempts.length, 1)
    assert.equal(o.derived_production_card_id, null)
  }
})

test('code exhaustion terminates loudly after bounded attempts', async () => {
  const o = offer(3), f = fixture([o], { exhaust: true })
  await assert.rejects(f.create(o.id, null), /uq_projects_moment_code/)
  assert.equal(f.attempts.length, 28)
  assert.equal(f.projects.length, 0)
})

test('reverse-link failure is recoverable; failed healing is surfaced', async () => {
  const o = offer(3), f = fixture([o], { linkError: { message: 'link unavailable' } })
  await f.create(o.id, null)
  assert.equal(o.derived_production_card_id, null)
  await assert.rejects(f.create(o.id, null), /reverse link failed/)
  delete f.options.linkError
  await f.create(o.id, null)
  assert.equal(o.derived_production_card_id, f.projects[0].id)
  assert.equal(f.projects.length, 1)
})
