// What may be attached to a brand, and how big.
//
// Shared by the browser (so the person gets a real message before a 250MB upload
// starts) and by the Server Actions (so the rule is actually enforced). It
// cannot live in actions.ts: that file is 'use server' and may only export
// async functions.

export const BRAND_DOC_BUCKET = 'brand-docs'

export interface BrandDocType {
  ext: string
  /** The row's type chip. */
  label: string
  /** True only where a browser has a real renderer. Drives whether "View" exists at all. */
  inline: boolean
  /** Named in the row when it does not. */
  opensIn: string | null
}

export const BRAND_DOC_TYPES: Record<string, BrandDocType> = {
  'application/pdf': { ext: 'pdf', label: 'PDF', inline: true, opensIn: null },
  'text/plain': { ext: 'txt', label: 'TXT', inline: true, opensIn: null },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    { ext: 'docx', label: 'DOCX', inline: false, opensIn: 'Word' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    { ext: 'pptx', label: 'PPTX', inline: false, opensIn: 'PowerPoint' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    { ext: 'xlsx', label: 'XLSX', inline: false, opensIn: 'Excel' },
  // Client assets from the intake link (20261104_brand_intake_link.sql).
  'image/png': { ext: 'png', label: 'PNG', inline: true, opensIn: null },
  'image/jpeg': { ext: 'jpg', label: 'JPG', inline: true, opensIn: null },
  'image/webp': { ext: 'webp', label: 'WEBP', inline: true, opensIn: null },
  'image/gif': { ext: 'gif', label: 'GIF', inline: true, opensIn: null },
  'image/heic': { ext: 'heic', label: 'HEIC', inline: false, opensIn: 'Photos' },
  'image/tiff': { ext: 'tif', label: 'TIFF', inline: false, opensIn: 'an image app' },
  // Not inline: an SVG can carry script, and the viewer frame allows scripts.
  'image/svg+xml': { ext: 'svg', label: 'SVG', inline: false, opensIn: 'a browser or Illustrator' },
  'image/vnd.adobe.photoshop': { ext: 'psd', label: 'PSD', inline: false, opensIn: 'Photoshop' },
  'application/postscript': { ext: 'eps', label: 'EPS/AI', inline: false, opensIn: 'Illustrator' },
  'font/ttf': { ext: 'ttf', label: 'TTF', inline: false, opensIn: 'Font Book' },
  'font/otf': { ext: 'otf', label: 'OTF', inline: false, opensIn: 'Font Book' },
  'font/woff': { ext: 'woff', label: 'WOFF', inline: false, opensIn: 'Font Book' },
  'font/woff2': { ext: 'woff2', label: 'WOFF2', inline: false, opensIn: 'Font Book' },
  'application/zip': { ext: 'zip', label: 'ZIP', inline: false, opensIn: 'Finder' },
}

// Both extensions and MIME types: Safari matches on type, Windows Chrome often
// only has the extension to go on.
export const BRAND_DOC_ACCEPT = [
  ...Object.values(BRAND_DOC_TYPES).map(t => `.${t.ext}`),
  '.jpeg', '.tiff', '.ai',
  ...Object.keys(BRAND_DOC_TYPES),
].join(',')

// Every type up to 250MB (raised 17 Oct; PDFs were 100MB, the rest 50MB).
// Print-ready brand books with full-bleed photography run past 100MB.
//
// The brand-docs bucket's file_size_limit is 250MB — the ceiling a forged
// request cannot talk past — and Supabase's project-wide upload limit
// (Dashboard -> Project Settings -> Storage) must be at least that, or every
// file over it is refused AFTER uploading in full. This constant only lets
// the browser say so before an upload starts.
export const MAX_BRAND_DOC_BYTES = 250 * 1024 * 1024

const BY_EXT: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BRAND_DOC_TYPES).map(([mime, spec]) => [spec.ext, mime])),
  jpeg: 'image/jpeg', tiff: 'image/tiff', ai: 'application/postscript',
}

// What browsers report for the same files under other names.
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/x-png': 'image/png',
  'application/x-zip-compressed': 'application/zip',
  'application/x-font-ttf': 'font/ttf', 'application/x-font-otf': 'font/otf',
  'application/font-woff': 'font/woff', 'application/font-woff2': 'font/woff2',
  'application/illustrator': 'application/postscript',
}

/**
 * The file's own type when the browser reports one we accept, else its
 * extension. Browsers hand back '' for .docx and .pptx on plenty of machines,
 * and refusing those would refuse half the real uploads — but the fallback can
 * only ever land on a type already in the allowlist.
 */
export function resolveDocType(file: { name: string; type: string }): string | null {
  if (file.type && BRAND_DOC_TYPES[file.type]) return file.type
  if (file.type && MIME_ALIASES[file.type]) return MIME_ALIASES[file.type]
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return BY_EXT[ext] ?? null
}

/** The filename NEVER builds the path: the extension comes from the allowlist. */
export function brandDocPath(brandId: string, contentType: string): string {
  const spec = BRAND_DOC_TYPES[contentType]
  return `${brandId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${spec.ext}`
}

/**
 * The display name, made safe. Slashes and control characters are stripped —
 * not because they reach the path (they cannot, see brandDocPath) but because
 * they make a nonsense of the row and of Content-Disposition. Unicode letters
 * survive: "Rückblick.pdf" is the name the client gave it.
 */
export function safeDocName(raw: string, contentType: string): string {
  const cleaned = raw
    .replace(/[\\/\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  return cleaned || `document.${BRAND_DOC_TYPES[contentType]?.ext ?? 'bin'}`
}

/**
 * Content-Disposition is an ASCII header. Storage's ?download= writes the name
 * into it verbatim, and a non-ASCII or quote-bearing name comes back mangled or
 * makes the header invalid — so the SAVED name is folded while the row keeps
 * showing the real one.
 */
export const asciiDocName = (name: string): string =>
  name.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_')

/** brandId arrives from the browser in the action call; '..' must not reach a path. */
export const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export const MB = 1048576
