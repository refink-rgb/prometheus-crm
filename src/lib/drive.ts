// Google Drive helpers.
//
// Auth strategy:
//   - Writes (create folder, move file) REQUIRE a service-account JSON in
//     GOOGLE_DRIVE_SA_KEY. Throws a clear error if missing.
//   - Reads PREFER the service account when available, and fall back to
//     GOOGLE_DRIVE_API_KEY for backward compat (existing deploys may not have
//     SA configured yet).
//
// The SA token is cached in-memory for ~50 minutes (Drive tokens live 60).

import { JWT } from 'google-auth-library'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

let cachedToken: { token: string; expiresAt: number } | null = null

function readServiceAccountKey():
  | { client_email: string; private_key: string }
  | null {
  const raw = process.env.GOOGLE_DRIVE_SA_KEY
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      client_email?: string
      private_key?: string
    }
    if (!parsed.client_email || !parsed.private_key) return null
    return {
      client_email: parsed.client_email,
      // Vercel-style env vars often store newlines as literal "\n" — normalize.
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    }
  } catch {
    return null
  }
}

/** True if a service-account key is configured (and parsable). */
export function hasDriveServiceAccount(): boolean {
  return readServiceAccountKey() !== null
}

/**
 * Get a Bearer access token for the configured service account.
 * Cached in-memory for ~50 minutes.
 */
export async function getDriveAccessToken(): Promise<string> {
  const sa = readServiceAccountKey()
  if (!sa) {
    throw new Error(
      'GOOGLE_DRIVE_SA_KEY is not set. Drive write operations (move-to-Delete) require a service account JSON in this env var.'
    )
  }

  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }

  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [DRIVE_SCOPE],
  })

  const { access_token, expiry_date } = await jwt.authorize()
  if (!access_token) {
    throw new Error('Failed to obtain Drive access token from service account.')
  }

  // Cap our cache at 50 minutes regardless of what Google returns, to stay
  // comfortably under the 60-minute token life.
  const cap = now + 50 * 60_000
  const expiresAt = expiry_date ? Math.min(expiry_date, cap) : cap

  cachedToken = { token: access_token, expiresAt }
  return access_token
}

/** Extract the folder ID from a Drive folder URL. */
export function extractDriveFolderId(folderUrl: string): string {
  const match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (!match) {
    throw new Error(
      'Invalid Google Drive folder URL. Expected format: https://drive.google.com/drive/folders/...'
    )
  }
  return match[1]
}

// modifiedTime is what makes a replaced file visible. Drive's thumbnail endpoint
// is keyed on the file ID alone and its CDN caches hard, so swapping a file's
// CONTENTS in Drive — same ID — keeps serving the old render for hours. Carrying
// the modified time lets the sync put a version on the URL.
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }

/**
 * List the creatives in a Drive folder — images and videos — non-recursive,
 * non-trashed. Uses SA if available, else falls back to GOOGLE_DRIVE_API_KEY.
 *
 * Videos used to be filtered out here, silently: a folder of video ads synced
 * to an empty project with no reason given.
 */
export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  return (await listDriveChildren(folderId)).filter(isCreativeFile)
}

const isCreativeFile = (f: DriveFile) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * Creatives in a folder and in the subfolders `includeFolder` accepts, recursively.
 * Each file carries the subfolder names it sits under. Folders that are refused come
 * back in `skippedFolders` and are not opened.
 */
export async function listDriveFolderTree(
  folderId: string,
  includeFolder: (name: string) => boolean,
  depth = 3,
): Promise<{ files: (DriveFile & { folderPath: string[] })[]; skippedFolders: string[]; opened: { path: string; creatives: number }[]; ignored: string[] }> {
  const files: (DriveFile & { folderPath: string[] })[] = []
  const skippedFolders: string[] = []
  // What the walk actually saw, so a sync that copies nothing can say why.
  const opened: { path: string; creatives: number }[] = []
  const ignored: string[] = []
  const walk = async (id: string, path: string[]) => {
    const here = { path: path.join(' / ') || '(pasted folder)', creatives: 0 }
    opened.push(here)
    for (const child of await listDriveChildren(id)) {
      if (isCreativeFile(child)) { files.push({ ...child, folderPath: path }); here.creatives++ }
      else if (child.mimeType !== DRIVE_FOLDER_MIME) ignored.push(`${[...path, child.name].join(' / ')} (${child.mimeType})`)
      else {
        // Below an accepted folder everything counts ("Statics/Pre-BF").
        if (path.length > 0 || includeFolder(child.name)) { if (path.length < depth) await walk(child.id, [...path, child.name]) }
        else skippedFolders.push(child.name)
      }
    }
  }
  await walk(folderId, [])
  return { files, skippedFolders, opened, ignored }
}

async function listDriveChildren(folderId: string): Promise<DriveFile[]> {
  const sa = readServiceAccountKey()
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY

  if (!sa && !apiKey) {
    throw new Error(
      'No Drive auth configured. Set GOOGLE_DRIVE_SA_KEY (preferred) or GOOGLE_DRIVE_API_KEY.'
    )
  }

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,modifiedTime,size,shortcutDetails(targetId,targetMimeType))',
    orderBy: 'name',
    pageSize: '200',
    // Without these, anything living in a shared drive is left out of the listing.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })

  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}${
    !sa && apiKey ? `&key=${apiKey}` : ''
  }`

  const headers: Record<string, string> = {}
  if (sa) {
    const token = await getDriveAccessToken()
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      `Drive API error: ${err.error?.message ?? res.statusText}`
    )
  }
  const data = (await res.json()) as { files?: (DriveFile & { shortcutDetails?: { targetId?: string; targetMimeType?: string } })[] }
  return (data.files ?? []).map(({ shortcutDetails, ...f }) => {
    // A shortcut was dropped silently. Follow it to what it points at, keeping its name.
    if (f.mimeType === DRIVE_SHORTCUT_MIME && shortcutDetails?.targetId && shortcutDetails.targetMimeType) return { ...f, id: shortcutDetails.targetId, mimeType: shortcutDetails.targetMimeType }
    // Uploads Drive couldn't type (octet-stream) still count when the extension says image or video.
    if (!isCreativeFile(f) && f.mimeType !== DRIVE_FOLDER_MIME) {
      const byExt = MIME_BY_EXT[(f.name.split('.').pop() ?? '').toLowerCase()]
      if (byExt) return { ...f, mimeType: byExt }
    }
    return f
  })
}
const DRIVE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'
const MIME_BY_EXT: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/**
 * Download one Drive file's bytes. Service account only — the API-key fallback
 * cannot read file contents. `maxBytes` refuses before downloading when Drive
 * reports a larger size, and again while reading if it did not.
 */
export async function downloadDriveFile(
  fileId: string,
  maxBytes: number,
): Promise<{ ok: true; bytes: Buffer; mimeType: string } | { ok: false; reason: 'too_large' | 'error'; message: string }> {
  if (!readServiceAccountKey()) return { ok: false, reason: 'error', message: 'Drive service account is not configured.' }
  const token = await getDriveAccessToken()
  const headers = { Authorization: `Bearer ${token}` }

  const meta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=size,mimeType&supportsAllDrives=true`,
    { headers },
  )
  if (!meta.ok) return { ok: false, reason: 'error', message: `Drive could not find the file (HTTP ${meta.status}).` }
  const m = (await meta.json()) as { size?: string; mimeType?: string }
  if (m.size && Number(m.size) > maxBytes) {
    return { ok: false, reason: 'too_large', message: `${(Number(m.size) / 1048576).toFixed(1)}MB` }
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, { headers })
  if (!res.ok || !res.body) return { ok: false, reason: 'error', message: `Drive download failed (HTTP ${res.status}).` }
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, reason: 'too_large', message: `over ${(maxBytes / 1048576).toFixed(0)}MB` }
    }
    chunks.push(value)
  }
  return { ok: true, bytes: Buffer.concat(chunks), mimeType: m.mimeType ?? res.headers.get('content-type') ?? 'video/mp4' }
}

/**
 * Find — or create — a "Delete" subfolder under the given parent folder.
 * Requires SA auth (folder creation is a write).
 */
export async function ensureDeleteSubfolder(
  parentFolderId: string
): Promise<string> {
  const token = await getDriveAccessToken()

  // Look for an existing "Delete" subfolder first.
  const searchParams = new URLSearchParams({
    q: `'${parentFolderId}' in parents and name='Delete' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '1',
  })

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!searchRes.ok) {
    const err = (await searchRes.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      `Drive API error (looking up Delete folder): ${
        err.error?.message ?? searchRes.statusText
      }`
    )
  }
  const searchData = (await searchRes.json()) as {
    files?: Array<{ id: string }>
  }
  const existing = searchData.files?.[0]
  if (existing) return existing.id

  // Not found — create it.
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Delete',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }),
    }
  )
  if (!createRes.ok) {
    const err = (await createRes.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      `Drive API error (creating Delete folder): ${
        err.error?.message ?? createRes.statusText
      }`
    )
  }
  const created = (await createRes.json()) as { id: string }
  return created.id
}

async function getDriveFileParents(fileId: string): Promise<string[]> {
  const token = await getDriveAccessToken()
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      `Drive API error (reading file parents): ${
        err.error?.message ?? res.statusText
      }`
    )
  }
  const data = (await res.json()) as { parents?: string[] }
  return data.parents ?? []
}

/**
 * Move fileId from fromParentId to toParentId. If the file is already in
 * toParentId (and not in fromParentId), this is a no-op — making the call
 * idempotent so batch purges don't error out on already-moved files.
 */
export async function moveDriveFile(
  fileId: string,
  fromParentId: string,
  toParentId: string
): Promise<void> {
  if (fromParentId === toParentId) return

  const token = await getDriveAccessToken()

  // Idempotency: check current parents before mutating.
  const currentParents = await getDriveFileParents(fileId)
  const inTarget = currentParents.includes(toParentId)
  const inSource = currentParents.includes(fromParentId)

  if (inTarget && !inSource) {
    // Already moved — nothing to do.
    return
  }

  const params = new URLSearchParams({
    addParents: toParentId,
    fields: 'id,parents',
  })
  if (inSource) params.set('removeParents', fromParentId)

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      `Drive API error (moving file ${fileId}): ${
        err.error?.message ?? res.statusText
      }`
    )
  }
}

/**
 * Find — or create — a named subfolder under the given parent folder.
 * Generalised from ensureDeleteSubfolder. Requires SA auth (creation is a write).
 */
export async function ensureSubfolder(
  parentFolderId: string,
  name: string
): Promise<string> {
  const token = await getDriveAccessToken()
  const escaped = name.replace(/'/g, "\\'")

  const searchParams = new URLSearchParams({
    q: `'${parentFolderId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '1',
  })
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!searchRes.ok) {
    const err = (await searchRes.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`Drive API error (looking up "${name}" folder): ${err.error?.message ?? searchRes.statusText}`)
  }
  const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> }
  const existing = searchData.files?.[0]
  if (existing) return existing.id

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] }),
  })
  if (!createRes.ok) {
    const err = (await createRes.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`Drive API error (creating "${name}" folder): ${err.error?.message ?? createRes.statusText}`)
  }
  const created = (await createRes.json()) as { id: string }
  return created.id
}

/**
 * Upload bytes into a Drive folder, replacing any file already there with the
 * same name. Overwrite-by-name is deliberate: pushing approved creatives twice
 * should refresh the folder, not fill it with "file (1).png" duplicates.
 */
export async function uploadFileToDriveFolder(
  folderId: string,
  fileName: string,
  bytes: Buffer,
  mimeType = 'image/png'
): Promise<{ id: string; replaced: boolean }> {
  const token = await getDriveAccessToken()
  const escaped = fileName.replace(/'/g, "\\'")

  const findParams = new URLSearchParams({
    q: `'${folderId}' in parents and name='${escaped}' and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  })
  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?${findParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const findData = findRes.ok ? ((await findRes.json()) as { files?: Array<{ id: string }> }) : { files: [] }
  const existingId = findData.files?.[0]?.id ?? null

  // Multipart: metadata part + binary part in one request.
  const boundary = `pcrm${Date.now().toString(36)}`
  const metadata = existingId ? {} : { name: fileName, parents: [folderId] }
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  )
  const tail = Buffer.from(`\r\n--${boundary}--`)
  const body = Buffer.concat([head, bytes, tail])

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id'

  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body: body as unknown as BodyInit,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`Drive upload failed for "${fileName}": ${err.error?.message ?? res.statusText}`)
  }
  const out = (await res.json()) as { id: string }
  return { id: out.id, replaced: !!existingId }
}
