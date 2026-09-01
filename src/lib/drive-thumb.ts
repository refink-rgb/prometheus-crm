// One place that builds a Drive thumbnail URL.
//
// Drive's thumbnail endpoint is keyed on the file ID alone and its CDN caches
// hard, so replacing a file's CONTENTS in Drive — which keeps the same ID —
// keeps serving the old render. An editor who fixes an ad in Drive, re-syncs,
// and still sees the old image concludes the CRM ignored them.
//
// &v= is ours, not something Drive reads. Keyed on the file's modifiedTime so
// the URL changes when, and only when, the file does.
//
// Pure and dependency-free so both the server sync and the client components can
// use it — actions.ts is 'use server' and cannot export a synchronous function.
export function driveThumb(
  fileId: string,
  size: 600 | 2048 = 600,
  version?: string | null,
): string {
  const v = version ? `&v=${Date.parse(version) || 0}` : ''
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}${v}`
}

/**
 * Re-point a stored thumbnail URL at a different size, keeping whatever version
 * it already carries. The stored URL is the only place the version lives once a
 * sync has run, so the full-size view has to derive from it rather than rebuild
 * from the file ID and lose it.
 */
export function resizeDriveThumb(url: string | null | undefined, size: 600 | 2048): string | null {
  if (!url) return null
  return url.replace(/([?&]sz=)w\d+/, `$1w${size}`)
}
