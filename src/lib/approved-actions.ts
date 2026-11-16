'use server'

// Getting a client's approved files out of the CRM, for BFCM calibration and
// Evergreen Ads. Two ways out:
//   - listApprovedFiles: the files' public URLs, which the browser zips itself
//     (a server-built zip of videos would blow past the function's size limit).
//   - startApprovedDriveFolder + sendApprovedFileToDrive: an "Approved" folder
//     inside the folder the team synced from, filled one file per request (the
//     same pattern as the Drive sync, so a folder of videos never hits a timeout).
// Staff only (canEdit), like every other action in both modules.
//
// "Approved" means what the client said:
//   - BFCM: a calibration sample the client marked "Looks good" (client_status = 'approved').
//   - Evergreen: a static or video with status = 'approved' (per file, or "Approve all").

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canEdit } from '@/lib/permissions'
import { extractDriveFolderId } from '@/lib/drive'
import { CALIBRATION_BUCKET } from '@/lib/bfcm/calibration-drive'
import {
  DriveWriteError, canWriteDrive, copyInto, driveAccountEmail, driveFileInfo, ensureFolder, folderLink, listTagged, shortcutInto, trashFile, uploadInto, type Tag,
} from '@/lib/approved-drive'

export type ApprovedKind = 'bfcm' | 'evergreen'
type Fail = { ok: false; error: string }
type Group = 'Statics' | 'Motion'
type Item = { id: string; name: string; group: Group; url: string; ext: string; mimeType: string; rev: string; driveFileId: string | null; driveModifiedAt: string | null }

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' }
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])
const validKey = (kind: ApprovedKind, key: unknown): key is string => typeof key === 'string' && (kind === 'bfcm' ? /^[a-z0-9][a-z0-9-]{0,99}$/.test(key) : /^[0-9a-f-]{36}$/i.test(key))
const extOf = (path: string) => (path.split('?')[0].split('.').pop() ?? '').toLowerCase()
/** "Storage path minus folder and extension": a new upload or a new version gets a new one. */
const revOf = (path: string) => (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').slice(0, 64)
const fileName = (item: Item) => `${item.name.replace(/[\u0000-\u001f/\\]/g, ' ').trim() || 'Creative'}.${item.ext}`

async function isStaff(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && await canEdit(user.email)
}

/** The approved files and the Drive folder they were synced from (if any). */
async function loadApproved(kind: ApprovedKind, key: string): Promise<{ ok: true; items: Item[]; driveFolderUrl: string | null } | Fail> {
  const db = createServiceClient()
  if (kind === 'bfcm') {
    const [cal, rows] = await Promise.all([
      db.from('bfcm_calibrations').select('drive_folder_url').eq('plan_slug', key).maybeSingle(),
      db.from('bfcm_calibration_items').select('id,track,name,media_type,storage_path,drive_file_id,drive_modified_at,sort_order').eq('plan_slug', key).eq('client_status', 'approved').order('track').order('sort_order'),
    ])
    if (rows.error) return { ok: false, error: MISSING.has(rows.error.code ?? '') ? 'Calibration tables are missing. Run the BFCM calibration migration in Supabase first.' : 'Could not read the approved samples.' }
    const items = (rows.data ?? []).map(r => {
      const path = r.storage_path as string
      const ext = extOf(path)
      return {
        id: r.id as string, name: r.name as string, group: (r.track === 'motion' ? 'Motion' : 'Statics') as Group,
        url: db.storage.from(CALIBRATION_BUCKET).getPublicUrl(path).data.publicUrl, ext, mimeType: MIME[ext] ?? (r.media_type === 'video' ? 'video/mp4' : 'image/jpeg'),
        rev: revOf(path), driveFileId: (r.drive_file_id as string | null) ?? null, driveModifiedAt: (r.drive_modified_at as string | null) ?? null,
      }
    })
    return { ok: true, items, driveFolderUrl: (cal.data?.drive_folder_url as string | null | undefined) ?? null }
  }

  // select('*'): drive_* and media_type only exist after the 20261110 migration.
  const [ad, rows] = await Promise.all([
    db.from('evergreen_ads').select('*').eq('id', key).maybeSingle(),
    db.from('evergreen_ad_videos').select('*').eq('ad_id', key).eq('status', 'approved').order('sort_order'),
  ])
  if (ad.error || rows.error) return { ok: false, error: MISSING.has((ad.error ?? rows.error)?.code ?? '') ? 'Evergreen tables are missing. Run the Evergreen migration in Supabase first.' : 'Could not read the approved files.' }
  if (!ad.data) return { ok: false, error: 'That ad no longer exists.' }
  const items = (rows.data ?? []).map(r => {
    const path = r.storage_path as string
    const ext = extOf(path)
    const image = r.media_type === 'image'
    return {
      id: r.id as string, name: r.name as string, group: (image ? 'Statics' : 'Motion') as Group,
      url: r.video_url as string, ext, mimeType: MIME[ext] ?? (image ? 'image/jpeg' : 'video/mp4'),
      rev: revOf(path), driveFileId: (r.drive_file_id as string | null | undefined) ?? null, driveModifiedAt: (r.drive_modified_at as string | null | undefined) ?? null,
    }
  })
  return { ok: true, items, driveFolderUrl: (ad.data.drive_folder_url as string | null | undefined) ?? null }
}

// ── Zip (built in the browser) ──────────────────────────────────────────────

export async function listApprovedFiles(kind: ApprovedKind, key: string): Promise<{ ok: true; files: { name: string; folder: Group; url: string }[] } | Fail> {
  try {
    if (!await isStaff()) return { ok: false, error: 'Not authorized.' }
    if (!validKey(kind, key)) return { ok: false, error: 'Invalid request.' }
    const loaded = await loadApproved(kind, key)
    if (!loaded.ok) return loaded
    return { ok: true, files: loaded.items.map(i => ({ name: fileName(i), folder: i.group, url: i.url })) }
  } catch (e) {
    console.error('[approved files] list', kind, key, e)
    return { ok: false, error: 'Something went wrong. Reload and try again.' }
  }
}

// ── Drive folder ────────────────────────────────────────────────────────────

const scopeOf = (kind: ApprovedKind, key: string) => `${kind}:${key}`

function driveError(e: unknown, what: string): string {
  if (e instanceof DriveWriteError && e.noAccess) {
    const who = driveAccountEmail()
    return `The CRM can’t write to that Drive folder. Share it with ${who ?? 'the CRM’s Drive account'} as Editor, then try again.`
  }
  console.error('[approved files]', what, e)
  return `Drive error (${what}): ${e instanceof Error ? e.message : 'unknown'}`
}

/** The "Approved" folder under the synced folder, with Statics and Motion inside. */
async function approvedFolders(driveFolderUrl: string) {
  const root = await ensureFolder(extractDriveFolderId(driveFolderUrl), 'Approved')
  return { root, sub: async (group: Group) => ensureFolder(root, group) }
}

/**
 * Makes (or finds) the Approved folder and brings it in line with what is approved now:
 * copies of files no longer approved, or since replaced by a new version, are moved to
 * the trash. Returns the files still to send, one sendApprovedFileToDrive call each.
 */
export async function startApprovedDriveFolder(kind: ApprovedKind, key: string): Promise<{ ok: true; folderUrl: string; todo: { id: string; name: string }[]; alreadyThere: number; removed: number } | Fail> {
  try {
    if (!await isStaff()) return { ok: false, error: 'Not authorized.' }
    if (!validKey(kind, key)) return { ok: false, error: 'Invalid request.' }
    if (!canWriteDrive()) return { ok: false, error: 'The CRM has no Drive account set up (GOOGLE_DRIVE_SA_KEY). Use Download .zip instead.' }
    const loaded = await loadApproved(kind, key)
    if (!loaded.ok) return loaded
    if (!loaded.driveFolderUrl) return { ok: false, error: 'Sync a Drive folder first. The Approved folder is made inside it. Or use Download .zip.' }

    let root: string
    try { root = (await approvedFolders(loaded.driveFolderUrl)).root } catch (e) { return { ok: false, error: driveError(e, 'making the Approved folder') } }

    const current = new Map(loaded.items.map(i => [i.id, i]))
    const kept = new Set<string>()
    let removed = 0
    for (const f of await listTagged(scopeOf(kind, key))) {
      const item = current.get(f.appProperties.crmItem)
      if (item && item.rev === f.appProperties.crmRev && !kept.has(item.id)) { kept.add(item.id); continue }
      try { await trashFile(f.id); removed++ } catch (e) { console.error('[approved files] trash', f.id, e) }
    }
    const todo = loaded.items.filter(i => !kept.has(i.id)).map(i => ({ id: i.id, name: fileName(i) }))
    return { ok: true, folderUrl: folderLink(root), todo, alreadyThere: kept.size, removed }
  } catch (e) {
    return { ok: false, error: driveError(e, 'preparing the folder') }
  }
}

/**
 * Puts one approved file in the Approved folder:
 *   1. a real copy of the team's Drive original, when it is still the version the client approved;
 *   2. else the CRM's own copy, uploaded;
 *   3. if Drive refuses to store files for the CRM (a My Drive folder), a shortcut to the original.
 */
export async function sendApprovedFileToDrive(kind: ApprovedKind, key: string, itemId: string): Promise<{ ok: true; how: 'copied' | 'uploaded' | 'shortcut' | 'already' } | Fail> {
  try {
    if (!await isStaff()) return { ok: false, error: 'Not authorized.' }
    if (!validKey(kind, key) || typeof itemId !== 'string') return { ok: false, error: 'Invalid request.' }
    const loaded = await loadApproved(kind, key)
    if (!loaded.ok) return loaded
    const item = loaded.items.find(i => i.id === itemId)
    if (!item) return { ok: false, error: 'No longer approved.' }
    if (!loaded.driveFolderUrl) return { ok: false, error: 'No Drive folder.' }

    const scope = scopeOf(kind, key)
    // A double click or a second tab: don't make it twice.
    if ((await listTagged(scope)).some(f => f.appProperties.crmItem === item.id && f.appProperties.crmRev === item.rev)) return { ok: true, how: 'already' }

    const folder = await (await approvedFolders(loaded.driveFolderUrl)).sub(item.group)
    const tag: Tag = { crmScope: scope, crmItem: item.id, crmRev: item.rev }
    const name = fileName(item)

    let original = false
    if (item.driveFileId) {
      const info = await driveFileInfo(item.driveFileId)
      original = !!info && !info.trashed && (!item.driveModifiedAt || info.modifiedTime === item.driveModifiedAt)
    }

    let noStorage = false
    if (original) {
      try { await copyInto(item.driveFileId!, folder, name, tag); return { ok: true, how: 'copied' } } catch (e) {
        if (!(e instanceof DriveWriteError && e.noStorage)) return { ok: false, error: driveError(e, name) }
        noStorage = true
      }
    }
    if (!noStorage) {
      try { await uploadInto(item.url, folder, name, item.mimeType, tag); return { ok: true, how: 'uploaded' } } catch (e) {
        if (!(e instanceof DriveWriteError && e.noStorage)) return { ok: false, error: driveError(e, name) }
        noStorage = true
      }
    }
    if (original) {
      try { await shortcutInto(item.driveFileId!, folder, name, tag); return { ok: true, how: 'shortcut' } } catch (e) { return { ok: false, error: driveError(e, name) } }
    }
    return {
      ok: false,
      error: item.driveFileId
        ? `${name}: edited in Drive since the client approved it, and this Drive folder won’t take copies from the CRM. It’s in the .zip.`
        : `${name}: uploaded straight to the CRM, and this Drive folder won’t take copies from the CRM. It’s in the .zip.`,
    }
  } catch (e) {
    return { ok: false, error: driveError(e, 'sending a file') }
  }
}
