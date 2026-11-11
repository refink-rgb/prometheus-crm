// Offline tests: node --test scripts/bfcm-project-list.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as jsx from 'react/jsx-runtime'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const testModule = { exports: {} }
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, Date, require(name) {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return jsx
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }
    const resolved = name.startsWith('@/') ? `src/${name.slice(2)}` : path.join(path.dirname(relative), name)
    return load(`${resolved}.ts`)
  } }, { filename: relative })
  cache.set(relative, testModule.exports)
  return testModule.exports
}
const { projectRow, filterProjects, isProjectOverdue } = load('src/lib/bfcm/project-list.ts')
const task = (values = {}) => ({ id: 'task', plan_slug: 'alpha', parent_id: null, sort_order: 1, kind: 'review', title: 'Review client plan', plan_key: null, due_date: null, status: 'todo', assignees: [], commentCount: 0, children: [], ...values })
const row = (name, tasks = [], values = {}) => projectRow({ slug: name.toLowerCase().replaceAll(' ', '-'), version: 0, state: null, ...values }, name, tasks)
const empty = { query: '', planStatus: '', productionStatus: '', overdueOnly: false }
const ascending = { key: 'name', direction: 'asc' }
const today = '2026-11-07'
const names = list => Array.from(list, project => project.name)

test('plan statuses preserve not-started, in-progress and locked semantics', () => {
  assert.equal(row('A').planStatus, 'not_started')
  assert.equal(row('A', [], { version: 2 }).planStatus, 'in_progress')
  assert.equal(row('A', [], { state: { status: 'locked' } }).planStatus, 'locked')
  assert.equal(row('A').productionStatus, 'waiting')
})
test('all completed or not-required steps are Done and have no pending due date', () => {
  const project = row('A', [task({ status: 'done', due_date: '2026-11-01' }), task({ status: 'not_required' })])
  assert.equal(project.productionStatus, 'done')
  assert.equal(project.dueDate, null)
  assert.equal(isProjectOverdue(project, today), false)
})
test('first unfinished step and rolled-up children retain the original status rules', () => {
  const project = row('A', [task({ status: 'not_required' }), task({ kind: 'samples', due_date: '2026-11-03', children: [task({ status: 'done' }), task({ status: 'waiting_client' })] }), task({ kind: 'statics' })])
  assert.equal(project.productionStatus, 'client')
  assert.equal(project.productionLabel, 'Waiting on client')
  assert.equal(project.dueDate, '2026-11-03')
})
test('production kinds and custom task titles remain visible', () => {
  for (const [kind, expected] of [['review', 'review'], ['samples', 'calibration'], ['calibration_motion', 'calibration'], ['statics', 'ads'], ['motion', 'ads'], ['check', 'check']]) assert.equal(row('A', [task({ kind })]).productionStatus, expected)
  const project = row('A', [task({ kind: 'task', title: 'Confirm shipping cutoff' })])
  assert.equal(project.productionStatus, 'custom')
  assert.equal(project.productionLabel, 'Confirm shipping cutoff')
})
test('search ignores accents, case and surrounding whitespace', () => {
  assert.deepEqual(names(filterProjects([row('Élan Bags'), row('Bravo')], { ...empty, query: '  ELAN  ' }, ascending, today)), ['Élan Bags'])
})
test('all filters compose and clear without changing the input', () => {
  const rows = [row('Alpha', [task({ status: 'waiting_client', due_date: '2026-11-01' })], { state: { status: 'locked' } }), row('Beta'), row('Alpha 2', [task({ due_date: '2026-11-01' })])]
  const original = JSON.stringify(rows)
  const filters = { query: 'alpha', planStatus: 'locked', productionStatus: 'client', overdueOnly: true }
  assert.deepEqual(names(filterProjects(rows, filters, ascending, today)), ['Alpha'])
  assert.equal(filterProjects(rows, empty, ascending, today).length, 3)
  assert.equal(JSON.stringify(rows), original)
})
test('due today is not overdue and missing dates are not overdue', () => {
  const rows = [row('Past', [task({ due_date: '2026-11-06' })]), row('Today', [task({ due_date: today })]), row('Future', [task({ due_date: '2026-11-08' })]), row('Undated')]
  assert.deepEqual(names(filterProjects(rows, { ...empty, overdueOnly: true }, ascending, today)), ['Past'])
})
test('project name sorts naturally in both directions', () => {
  const rows = [row('Brand 10'), row('brand 2'), row('Alpha')]
  assert.deepEqual(names(filterProjects(rows, empty, ascending, today)), ['Alpha', 'brand 2', 'Brand 10'])
  assert.deepEqual(names(filterProjects(rows, empty, { ...ascending, direction: 'desc' }, today)), ['Brand 10', 'brand 2', 'Alpha'])
})
test('date sorting keeps undated projects last in both directions', () => {
  const rows = [row('Undated'), row('Later', [task({ due_date: '2026-12-01' })]), row('Earlier', [task({ due_date: '2026-11-01' })])]
  for (const [direction, expected] of [['asc', ['Earlier', 'Later', 'Undated']], ['desc', ['Later', 'Earlier', 'Undated']]]) assert.deepEqual(names(filterProjects(rows, empty, { key: 'dueDate', direction }, today)), expected)
})
test('both status columns sort by workflow order and reverse', () => {
  const rows = [row('Locked', [task({ status: 'done' })], { state: { status: 'locked' } }), row('New'), row('Progress', [task()], { version: 2 })]
  for (const key of ['planStatus', 'productionStatus']) {
    assert.deepEqual(names(filterProjects(rows, empty, { key, direction: 'asc' }, today)), ['New', 'Progress', 'Locked'])
    assert.deepEqual(names(filterProjects(rows, empty, { key, direction: 'desc' }, today)), ['Locked', 'Progress', 'New'])
  }
})
test('empty search results are safe', () => {
  assert.equal(filterProjects([], empty, ascending, today).length, 0)
  assert.equal(filterProjects([row('Alpha')], { ...empty, query: 'missing' }, ascending, today).length, 0)
})
test('rendered table has semantic headers, statuses, due date and the canonical project link', () => {
  const Table = load('src/components/bfcm/BfcmProjectsTable.tsx').default
  const markup = renderToStaticMarkup(React.createElement(Table, { today, projects: [row('Example & Co', [task({ due_date: '2026-11-03' })], { slug: 'canonical-project' })] }))
  assert.match(markup, /<table/)
  assert.match(markup, /aria-sort="ascending"/)
  assert.match(markup, /scope="row"/)
  assert.match(markup, /Onboarding not started yet/)
  assert.match(markup, /Reviewing plan/)
  assert.match(markup, /dateTime="2026-11-03"/)
  assert.match(markup, /Overdue/)
  assert.match(markup, /href="\/bfcm-creatives\/canonical-project"/)
  assert.match(markup, /Open Example &amp; Co project/)
  assert.match(renderToStaticMarkup(React.createElement(Table, { today, projects: [] })), /No plans yet/)
})
