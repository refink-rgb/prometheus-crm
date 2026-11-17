import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { daysLate, projectBucket, safeName, tallyAssets, tallyLine, waitingOn } from './board'

test('a project is launched when archived or when every track is live', () => {
  assert.equal(projectBucket('live', 'live', false), 'launched')
  assert.equal(projectBucket('client_review', 'brief', true), 'launched')
  assert.equal(projectBucket('done', 'live', false), 'launched') // pre-migration 'done'
  assert.equal(projectBucket('live', null, false), 'launched') // one-track project
})

test('ready means nothing is still being made', () => {
  assert.equal(projectBucket('ready', 'ready', false), 'ready')
  assert.equal(projectBucket('ready', 'live', false), 'ready')
  assert.equal(projectBucket(null, 'ready', false), 'ready')
  // One track still in review holds the whole project back.
  assert.equal(projectBucket('ready', 'client_review', false), 'working')
  assert.equal(projectBucket('client_review', 'live', false), 'working')
})

test('upcoming is only when nothing has started', () => {
  assert.equal(projectBucket('brief', 'brief', false), 'upcoming')
  assert.equal(projectBucket(null, null, false), 'upcoming')
  assert.equal(projectBucket('brief', 'in_progress', false), 'working')
  assert.equal(projectBucket('brief', 'live', false), 'working')
})

test('waitingOn names the client first', () => {
  assert.equal(waitingOn('client_review', 'in_progress', false), 'Waiting on client feedback')
  assert.equal(waitingOn('revisions', 'internal_review', false), 'Team is making the client’s changes')
  assert.equal(waitingOn('internal_review', 'brief', false), 'Being checked by our team')
  assert.equal(waitingOn('in_progress', 'live', false), 'Team is building it')
  assert.equal(waitingOn('brief', 'brief', false), 'Brief being written')
  assert.equal(waitingOn('ready', 'ready', false), 'Approved and ready to launch')
  assert.equal(waitingOn('live', 'live', false), 'Launched')
})

test('daysLate counts whole days and never flags finished work', () => {
  const today = new Date(2026, 10, 18, 15, 30) // 18 Nov 2026, mid-afternoon
  assert.equal(daysLate('2026-11-15', 'working', today), 3)
  assert.equal(daysLate('2026-11-18', 'working', today), 0)
  assert.equal(daysLate('2026-11-20', 'ready', today), 0)
  assert.equal(daysLate('2026-10-13', 'ready', today), 0) // finished: the launch is waiting, not the team
  assert.equal(daysLate('2026-11-01', 'launched', today), 0)
  assert.equal(daysLate(null, 'working', today), 0)
  assert.equal(daysLate('not a date', 'working', today), 0)
  assert.equal(daysLate('2026-11-15T00:00:00+00:00', 'working', today), 3)
})

test('tally counts only what the client can act on', () => {
  const t = tallyAssets(['approved', 'approved', 'pending', 'revised', 'needs_revision', 'rejected', null])
  assert.deepEqual(t, { approved: 2, awaiting: 2, changes: 1 })
  assert.equal(tallyLine(t), '2 approved · 2 awaiting client · 1 changes requested')
  assert.equal(tallyLine({ approved: 0, awaiting: 0, changes: 0 }), '')
})

test('safeName keeps names readable and zip-safe', () => {
  assert.equal(safeName('Black Friday / Statics: v2', 'x'), 'Black Friday _ Statics_ v2')
  assert.equal(safeName('  ../secret  ', 'x'), 'secret')
  assert.equal(safeName('', 'project'), 'project')
  assert.equal(safeName(null, 'project'), 'project')
})
