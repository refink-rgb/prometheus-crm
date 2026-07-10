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

type DriveFile = { id: string; name: string; mimeType: string }

/**
 * List image files in a Drive folder (non-recursive, non-trashed).
 * Uses SA if available, else falls back to GOOGLE_DRIVE_API_KEY.
 */
export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  const sa = readServiceAccountKey()
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY

  if (!sa && !apiKey) {
    throw new Error(
      'No Drive auth configured. Set GOOGLE_DRIVE_SA_KEY (preferred) or GOOGLE_DRIVE_API_KEY.'
    )
  }

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)',
    orderBy: 'name',
    pageSize: '200',
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
  const data = (await res.json()) as { files?: DriveFile[] }
  return (data.files ?? []).filter(f => f.mimeType.startsWith('image/'))
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
