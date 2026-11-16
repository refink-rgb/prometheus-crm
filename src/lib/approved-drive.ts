import 'server-only'
import { getDriveAccessToken, hasDriveServiceAccount } from '@/lib/drive'

// Putting a client's approved files into an "Approved" folder in Drive.
//
// What the CRM's Drive account (a service account) can and can't do:
//   - Folders, shortcuts and moves cost no storage, so they always work.
//   - A real copy or upload is a new file OWNED by the service account. Service
//     accounts have no storage of their own, so in a normal "My Drive" folder
//     Drive refuses it ("Service Accounts do not have storage quota"). In a
//     Shared Drive the drive owns the file, so it works.
// So each file is copied when Drive allows it, and otherwise becomes a shortcut
// to the team's original. A file that only exists in the CRM (uploaded straight
// to it) can't be shortcut to, so it is left to the .zip download.
//
// Every file made here is tagged with appProperties (scope, item, revision), so
// running it again only adds what is missing, replaces what changed, and removes
// what is no longer approved, without ever touching files people put there.

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'

export class DriveWriteError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string) { super(message) }
  /** Drive refused because the service account has no storage (a My Drive folder). */
  get noStorage() { return this.reason === 'storageQuotaExceeded' || /storage quota/i.test(this.message) }
  /** The service account can't see or edit the folder (not shared with it, or Viewer only). */
  get noAccess() { return this.status === 404 || /^(insufficientFilePermissions|insufficientPermissions|notFound)$/.test(this.reason) }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getDriveAccessToken()
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } }
    throw new DriveWriteError(err.error?.message ?? res.statusText, res.status, err.error?.errors?.[0]?.reason ?? '')
  }
  return (res.status === 204 ? {} : await res.json()) as T
}

const qs = (params: Record<string, string>) => new URLSearchParams({ supportsAllDrives: 'true', ...params }).toString()

export const canWriteDrive = hasDriveServiceAccount

/** The service account's email: the address a folder must be shared with. */
export function driveAccountEmail(): string | null {
  try { return (JSON.parse(process.env.GOOGLE_DRIVE_SA_KEY ?? '') as { client_email?: string }).client_email ?? null } catch { return null }
}

export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`

/** Find or create a folder by name under a parent. Works in My Drive and Shared Drives. */
export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const q = `'${parentId}' in parents and name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false`
  const found = await call<{ files?: { id: string }[] }>(`${API}?${qs({ q, fields: 'files(id)', pageSize: '1', includeItemsFromAllDrives: 'true' })}`)
  if (found.files?.[0]) return found.files[0].id
  const made = await call<{ id: string }>(`${API}?${qs({ fields: 'id' })}`, { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) })
  return made.id
}

export type Tag = { crmScope: string; crmItem: string; crmRev: string }
export type TaggedFile = { id: string; appProperties: Tag }

/** Every file this scope made before, wherever it sits. */
export async function listTagged(scope: string): Promise<TaggedFile[]> {
  const out: TaggedFile[] = []
  let pageToken = ''
  do {
    const page = await call<{ files?: TaggedFile[]; nextPageToken?: string }>(`${API}?${qs({
      q: `appProperties has { key='crmScope' and value='${scope.replace(/'/g, '')}' } and trashed=false`,
      fields: 'nextPageToken,files(id,appProperties)', pageSize: '1000', corpora: 'allDrives', includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    })}`)
    out.push(...(page.files ?? []))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return out
}

export async function trashFile(id: string): Promise<void> {
  await call(`${API}/${id}?${qs({ fields: 'id' })}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
}

export async function driveFileInfo(id: string): Promise<{ modifiedTime?: string; trashed?: boolean } | null> {
  try { return await call<{ modifiedTime?: string; trashed?: boolean }>(`${API}/${id}?${qs({ fields: 'modifiedTime,trashed' })}`) } catch { return null }
}

/** A real copy, made inside Drive (no bytes pass through the CRM). */
export async function copyInto(fileId: string, folderId: string, name: string, tag: Tag): Promise<string> {
  return (await call<{ id: string }>(`${API}/${fileId}/copy?${qs({ fields: 'id' })}`, { method: 'POST', body: JSON.stringify({ name, parents: [folderId], appProperties: tag }) })).id
}

/** A shortcut to the team's original: costs no storage, so it works in any folder. */
export async function shortcutInto(targetId: string, folderId: string, name: string, tag: Tag): Promise<string> {
  return (await call<{ id: string }>(`${API}?${qs({ fields: 'id' })}`, {
    method: 'POST', body: JSON.stringify({ name, mimeType: SHORTCUT_MIME, shortcutDetails: { targetId }, parents: [folderId], appProperties: tag }),
  })).id
}

/** Streams a file from our storage into Drive (resumable upload, so a large video is never held in memory). */
export async function uploadInto(sourceUrl: string, folderId: string, name: string, mimeType: string, tag: Tag): Promise<string> {
  const src = await fetch(sourceUrl)
  if (!src.ok || !src.body) throw new DriveWriteError(`Could not read the file from the CRM (HTTP ${src.status}).`, 0, 'source')
  const length = src.headers.get('content-length')
  const token = await getDriveAccessToken()
  const start = await fetch(`${UPLOAD_API}?${qs({ uploadType: 'resumable', fields: 'id' })}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, ...(length ? { 'X-Upload-Content-Length': length } : {}) },
    body: JSON.stringify({ name, parents: [folderId], appProperties: tag }),
  })
  const session = start.headers.get('location')
  if (!start.ok || !session) {
    await src.body.cancel().catch(() => {})
    const err = (await start.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } }
    throw new DriveWriteError(err.error?.message ?? start.statusText, start.status, err.error?.errors?.[0]?.reason ?? '')
  }
  // duplex is required by Node's fetch for a streamed body; the DOM RequestInit type doesn't know it.
  const put = await fetch(session, {
    method: 'PUT', body: src.body, headers: { 'Content-Type': mimeType, ...(length ? { 'Content-Length': length } : {}) }, duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  if (!put.ok) {
    const err = (await put.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } }
    throw new DriveWriteError(err.error?.message ?? put.statusText, put.status, err.error?.errors?.[0]?.reason ?? '')
  }
  return ((await put.json()) as { id: string }).id
}
