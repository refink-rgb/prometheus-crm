import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildKit, kitInstructions } from './kit'
import type { BoardBrand, BoardProject } from './server'

const asset = (id: string, name: string | null, media_type: 'image' | 'video' | null = 'image') => ({
  id, name, media_type, drive_file_id: 'd', thumbnail_url: null, published_url: null,
  revision_url: null, revision_poster_url: null, video_url: null,
})

const project: BoardProject = {
  id: '11111111-1111-1111-1111-111111111111', brandId: 'b', name: 'Fall Sale', dueDate: '2026-11-20T00:00:00+00:00',
  pageType: 'Listicle', lpStage: 'ready', creativesStage: 'done', lpUrl: 'https://example.com/pages/fall',
  shareToken: null, bucket: 'ready', waiting: 'Approved and ready to launch', late: 0,
  tally: { approved: 2, awaiting: 0, changes: 0 },
  approved: [asset('aaaaaaaa-0000-0000-0000-000000000001', 'hero.png'), asset('bbbbbbbb-0000-0000-0000-000000000002', '  ', 'video')],
}
const brand: BoardBrand = { id: 'b', name: 'Example Brand', website: 'https://example.com/', projects: [project] }

test('a kit carries the website URL and one direct link per approved file', () => {
  const kit = buildKit('https://crm.test', 'tok', brand, project)
  assert.equal(kit.client, 'Example Brand')
  assert.equal(kit.website_url, 'https://example.com/pages/fall')
  assert.equal(kit.status, 'Ready to launch')
  assert.deepEqual(kit.stages, { landing_page: 'Ready', creatives: 'Live' }) // 'done' reads as Live
  assert.equal(kit.due_date, '2026-11-20')
  assert.deepEqual(kit.approved_files, [
    { position: 1, file_name: 'hero.png', media_type: 'image', download_url: 'https://crm.test/api/status/tok/file?asset=aaaaaaaa-0000-0000-0000-000000000001&dl=1' },
    { position: 2, file_name: 'creative-bbbbbbbb', media_type: 'video', download_url: 'https://crm.test/api/status/tok/file?asset=bbbbbbbb-0000-0000-0000-000000000002&dl=1' },
  ])
  assert.equal(kit.kit_page_url, 'https://crm.test/status/tok/kit/11111111-1111-1111-1111-111111111111')
  assert.equal(kit.kit_json_url, 'https://crm.test/api/status/tok/kit?project=11111111-1111-1111-1111-111111111111')
})

test('agent instructions spell out every link and never invent a website URL', () => {
  const text = kitInstructions(buildKit('https://crm.test', 'tok', brand, project))
  assert.ok(text.startsWith('Upload the approved ads for Example Brand: Fall Sale.'))
  assert.ok(text.includes('Website URL for every ad: https://example.com/pages/fall'))
  assert.ok(text.includes('1. hero.png (image): https://crm.test/api/status/tok/file?asset=aaaaaaaa-0000-0000-0000-000000000001&dl=1'))
  assert.ok(text.includes('Approved files: 2'))

  const noUrl = kitInstructions(buildKit('https://crm.test', 'tok', brand, { ...project, lpUrl: null }))
  assert.ok(noUrl.includes('Website URL for every ad: NOT SET. Stop and ask a person before uploading.'))
})
