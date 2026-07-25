// Backfill creative_asset_revisions from files already in Supabase Storage.
//
// Every AI edit has always uploaded to revisions/{assetId}-{timestamp}.png and
// only the DB pointer was overwritten — so the full edit history is still on
// disk and can be reconstructed. Filename timestamps give the ordering.
//
// Safe to re-run: skips any asset that already has revision rows.
//
// Usage:
//   node scripts/backfill-asset-revisions.mjs --dry
//   node scripts/backfill-asset-revisions.mjs

import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const ENV_PATH = process.env.CRM_ENV ?? new URL('../.env.local', import.meta.url).pathname

function parseEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
}

const env = parseEnv(ENV_PATH)
const URL_ = (env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? '').replace(/\\n$/, '').trim()
const KEY = env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY (set CRM_ENV to point at an env file).')
  process.exit(1)
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const BUCKET = 'project-images'

// 1. Every revision file in storage, grouped by asset id.
const listed = []
for (let offset = 0; ; offset += 1000) {
  const res = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ prefix: 'revisions/', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
  })
  const page = await res.json()
  if (!Array.isArray(page)) throw new Error(`Storage list failed: ${JSON.stringify(page).slice(0, 200)}`)
  listed.push(...page)
  if (page.length < 1000) break
}

const byAsset = new Map()
for (const f of listed) {
  const m = f.name.match(/^([0-9a-f-]{36})-(\d+)\.png$/i)
  if (!m) continue
  const [, assetId, ts] = m
  if (!byAsset.has(assetId)) byAsset.set(assetId, [])
  byAsset.get(assetId).push({ ts: Number(ts), name: f.name })
}
for (const arr of byAsset.values()) arr.sort((a, b) => a.ts - b.ts)

console.log(`storage: ${listed.length} files → ${byAsset.size} assets with edits`)

// 2. Only backfill assets that still exist and have no rows yet.
const assetIds = [...byAsset.keys()]
const existingAssets = new Set()
for (let i = 0; i < assetIds.length; i += 100) {
  const chunk = assetIds.slice(i, i + 100)
  const res = await fetch(`${URL_}/rest/v1/creative_assets?select=id&id=in.(${chunk.join(',')})`, { headers: H })
  for (const row of await res.json()) existingAssets.add(row.id)
}

const alreadyDone = new Set()
for (let i = 0; i < assetIds.length; i += 100) {
  const chunk = assetIds.slice(i, i + 100)
  const res = await fetch(`${URL_}/rest/v1/creative_asset_revisions?select=asset_id&asset_id=in.(${chunk.join(',')})`, { headers: H })
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error(`Is the migration applied? ${JSON.stringify(rows).slice(0, 200)}`)
  for (const row of rows) alreadyDone.add(row.asset_id)
}

const rows = []
let skippedMissing = 0
for (const [assetId, files] of byAsset) {
  if (!existingAssets.has(assetId)) { skippedMissing++; continue }
  if (alreadyDone.has(assetId)) continue
  files.forEach((f, i) => {
    rows.push({
      asset_id: assetId,
      revision_number: i + 1,
      image_url: `${URL_}/storage/v1/object/public/${BUCKET}/${f.name}`,
      prompt: null, // not recoverable from storage — only the current edit's prompt survived on the asset
      created_by: null,
      created_at: new Date(f.ts).toISOString(),
    })
  })
}

console.log(`assets already backfilled: ${alreadyDone.size} · deleted assets skipped: ${skippedMissing}`)
console.log(`${DRY ? 'WOULD INSERT' : 'inserting'} ${rows.length} revision rows`)
if (DRY || rows.length === 0) process.exit(0)

for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200)
  const res = await fetch(`${URL_}/rest/v1/creative_asset_revisions`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(chunk),
  })
  if (!res.ok) throw new Error(`Insert failed at ${i}: ${await res.text()}`)
  console.log(`  inserted ${Math.min(i + 200, rows.length)}/${rows.length}`)
}
console.log('done')
