import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { effectiveStatus, productionSummary, type TaskNode } from './production'

const node = (status: string, children: TaskNode[] = [], kind = 'task'): TaskNode =>
  ({ id: Math.random().toString(36), plan_slug: 'x', parent_id: null, sort_order: 0, kind, title: kind, plan_key: null, due_date: null, status, assignees: [], commentCount: 0, children })

test('not required subtasks drop out of the parent status', () => {
  assert.equal(effectiveStatus(node('todo', [node('done'), node('not_required')])), 'done')
  assert.equal(effectiveStatus(node('todo', [node('todo'), node('not_required')])), 'todo')
  assert.equal(effectiveStatus(node('todo', [node('waiting_client'), node('not_required')])), 'waiting_client')
  assert.equal(effectiveStatus(node('todo', [node('not_required'), node('not_required')])), 'not_required')
})

test('a not required task counts as finished and is never the next step', () => {
  const summary = productionSummary([node('done', [], 'review'), node('not_required', [], 'samples'), node('todo', [], 'statics')])
  assert.equal(summary.done, 2)
  assert.equal(summary.next?.kind, 'statics')
})
