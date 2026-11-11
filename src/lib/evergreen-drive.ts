import 'server-only'
import { getDriveAccessToken, hasDriveServiceAccount, listDriveFolderTree } from '@/lib/drive'
import { mediaTypeOf } from '@/lib/evergreen'
import { isArchivedFolder, isArchivedPath, isTrackFolder } from '@/lib/bfcm/calibration-drive'

// Evergreen Ads: pulling statics and videos from a Drive folder, the way BFCM
// calibration does (bfcm/calibration-drive.ts). Every file is COPIED into our
// storage, so the client sees it on the review link without a Google sign-in.

export const isDriveFileId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id)

export const driveCreativeName = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || 'Creative'

export type DriveCreativeFile = { id: string; name: string; mimeType: string; modifiedTime?: string }

// Same folder rules as the BFCM calibration sync: only subfolders named for
// statics or motion are opened, so pasting a folder one level too high can't
// pull in "00 Assets", and "_old-versions" / "Archive" folders are skipped.

/**
 * The statics and videos in the folder: files directly in it, plus files in its
 * Statics / Motion subfolders. Anything else comes back by name, to say it was skipped.
 */
export async function listDriveCreatives(folderId: string): Promise<{ files: DriveCreativeFile[]; skipped: string[]; skippedFolders: string[] }> {
  const tree = await listDriveFolderTree(folderId, name => isTrackFolder(name) && !isArchivedFolder(name), 2)
  const listed = tree.files.filter(f => !isArchivedPath(f.folderPath))
  return {
    files: listed.filter(f => mediaTypeOf(f.mimeType)).map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime })),
    skipped: listed.filter(f => !mediaTypeOf(f.mimeType)).map(f => f.name),
    skippedFolders: tree.skippedFolders,
  }
}

/**
 * Drive's own still of a video, as JPEG bytes, for the player's poster. The
 * server cannot grab a frame itself (no ffmpeg on Vercel), but Drive renders
 * one. Copied into our storage like the video, because Drive's thumbnail URL
 * needs a Google sign-in for a folder that is not public.
 *
 * Best-effort: Drive may not have rendered one yet for a just-uploaded file.
 * No still means a dark tile with a play badge, never a failed copy.
 */
export async function fetchDriveVideoStill(fileId: string): Promise<Buffer | null> {
  if (!hasDriveServiceAccount()) return null
  try {
    const token = await getDriveAccessToken()
    const headers = { Authorization: `Bearer ${token}` }
    const meta = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink&supportsAllDrives=true`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
    if (!meta.ok) return null
    const { thumbnailLink } = (await meta.json()) as { thumbnailLink?: string }
    if (!thumbnailLink) return null
    // The link ends in "=s220"; ask for a size the full view can use.
    const big = /=s\d+$/.test(thumbnailLink) ? thumbnailLink.replace(/=s\d+$/, '=s1280') : thumbnailLink
    const res = await fetch(big, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.byteLength > 0 && bytes.byteLength < 10 * 1024 * 1024 ? bytes : null
  } catch (e) {
    console.error('[evergreen drive] no still for', fileId, e instanceof Error ? e.message : e)
    return null
  }
}
