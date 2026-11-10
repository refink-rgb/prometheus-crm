import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isArchivedFolder, isArchivedPath, isTrackFolder, planDriveSync, sampleName, sampleTrack } from './calibration-drive'

const file = (id: string, mimeType = 'image/png', modifiedTime = '2026-10-30T10:00:00Z') => ({ id, name: `${id}.png`, mimeType, modifiedTime })

test('new files are added, edited files refreshed, unchanged and unsupported counted', () => {
  const plan = planDriveSync(
    [file('newfile0001'), file('samefile001'), file('editedfile1', 'image/png', '2026-10-31T09:00:00Z'), file('notes000001', 'application/pdf')],
    [{ id: 'a', drive_file_id: 'samefile001', drive_modified_at: '2026-10-30T10:00:00Z' }, { id: 'b', drive_file_id: 'editedfile1', drive_modified_at: '2026-10-30T10:00:00Z' }, { id: 'c', drive_file_id: null, drive_modified_at: null }],
  )
  assert.deepEqual(plan.add.map(f => f.id), ['newfile0001'])
  assert.deepEqual(plan.refresh.map(r => [r.file.id, r.itemId]), [['editedfile1', 'b']])
  assert.equal(plan.unchanged, 1)
  assert.deepEqual(plan.unsupported, ['notes000001.png'])
})

test('sample names drop the extension and control characters', () => {
  assert.equal(sampleName('BF_offer_01.final.png'), 'BF_offer_01.final')
  assert.equal(sampleName('.png'), 'Sample')
})

test('the folder decides the track, and a loose file goes by its type', () => {
  assert.equal(sampleTrack({ mimeType: 'image/png', folderPath: ['Motion'] }), 'motion')
  assert.equal(sampleTrack({ mimeType: 'video/mp4', folderPath: ['Statics', 'Pre-BF'] }), 'statics')
  assert.equal(sampleTrack({ mimeType: 'video/mp4' }), 'motion')
  assert.equal(sampleTrack({ mimeType: 'image/png', folderPath: [] }), 'statics')
})

test('only folders named for a track are read', () => {
  assert.ok(isTrackFolder('Motion')); assert.ok(isTrackFolder('01 Statics'))
  assert.ok(!isTrackFolder('00 Assets')); assert.ok(!isTrackFolder('03 Final (ads team)')); assert.ok(!isTrackFolder('02 Production'))
})

test('old-version folders are skipped, real folders are not', () => {
  for (const name of ['_old-versions', 'Old', 'old versions', 'Archive', 'archived', 'Previous cuts', 'v1 - superseded']) assert.ok(isArchivedFolder(name), name)
  for (const name of ['Motion', 'Statics', 'Pre-BF', 'BF', 'Bold Offers', 'Golden hour']) assert.ok(!isArchivedFolder(name), name)
  assert.ok(isArchivedPath(['Motion', '_old-versions'])); assert.ok(!isArchivedPath(['Motion'])); assert.ok(!isArchivedPath(undefined))
})
