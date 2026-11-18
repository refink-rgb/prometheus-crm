import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { agentPrompt, buildKit } from './kit'
import type { BoardBrand, BoardProject } from './server'

const asset = (id: string, name: string | null, media_type: 'image' | 'video' | null = 'image') => ({
  id, name, media_type, drive_file_id: 'd', thumbnail_url: null, published_url: null,
  revision_url: null, revision_poster_url: null, video_url: null,
})

const project: BoardProject = {
  id: '11111111-1111-1111-1111-111111111111', brandId: 'b', name: 'Fall Sale', dueDate: '2026-11-20T00:00:00+00:00',
  pageType: 'Listicle', lpStage: 'ready', creativesStage: 'done', lpUrl: 'https://example.com/pages/fall',
  shareToken: null, bucket: 'ready', waiting: 'Approved and ready to launch', holder: 'none', late: 0, waitingDays: null, approvedBy: 'client',
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

test('the agent prompt carries the website URL, every file link and the Ads Uploader steps', () => {
  const text = agentPrompt(buildKit('https://crm.test', 'tok', brand, project))
  assert.ok(text.startsWith('Help me upload the approved ads for Example Brand (Fall Sale) to Meta with Ads Uploader.'))
  assert.ok(text.includes('Website URL for every ad: https://example.com/pages/fall'))
  assert.ok(text.includes('Approved files: 2 (approved by the client)'))
  assert.ok(text.includes('All files on one page: https://crm.test/status/tok/kit/11111111-1111-1111-1111-111111111111'))
  assert.ok(text.includes('1. hero.png (image): https://crm.test/api/status/tok/file?asset=aaaaaaaa-0000-0000-0000-000000000001&dl=1'))
  // Set-up for someone who has not connected Ads Uploader yet.
  assert.ok(text.includes('https://adsuploader.com/api/mcp'))
  for (const tool of ['ads_whoami', 'ads_list_accounts', 'ads_upload', 'ads_get_upload', 'ads_preview']) assert.ok(text.includes(tool), tool)
  // Nothing goes live on the agent's own word.
  assert.ok(text.includes('Create the ads paused'))
  assert.ok(text.includes('Never set anything live unless I say so.'))
  // Two files fit in one upload call, so there is no batching advice.
  assert.ok(!text.includes('batchId'))
})

test('the agent prompt never invents a website URL', () => {
  const noUrl = agentPrompt(buildKit('https://crm.test', 'tok', brand, { ...project, lpUrl: null }))
  assert.ok(noUrl.includes('Website URL for every ad: NOT SET. Ask me for it before you create any ad.'))
})

test('more files than one upload call takes are split into calls of 50', () => {
  const many = { ...project, approved: Array.from({ length: 51 }, (_, i) => asset(`aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`, `ad-${i}.png`)) }
  const text = agentPrompt(buildKit('https://crm.test', 'tok', brand, many))
  assert.ok(text.includes('Send at most 50 links per call'))
  assert.ok(text.includes('so all 51 files land in one batch'))
  assert.ok(text.includes('51. ad-50.png (image): '))
})

test('a team-approved kit says so, in the data and in the agent prompt', () => {
  const kit = buildKit('https://crm.test', 'tok', brand, { ...project, approvedBy: 'team' })
  assert.equal(kit.approved_by, 'team')
  const text = agentPrompt(kit)
  assert.ok(text.includes('Approved files: 2 (approved by our team)'))
  assert.ok(text.includes('Remind me to confirm it before any ad goes live.'))
  assert.ok(!text.includes('approved by the client'))
  assert.ok(agentPrompt(buildKit('https://crm.test', 'tok', brand, project)).includes('- Every file listed was approved by the client.'))
})
