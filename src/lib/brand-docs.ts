// What may be attached to a brand, and how big.
//
// Shared by the browser (so the person gets a real message before a 40MB upload
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
}

// Both extensions and MIME types: Safari matches on type, Windows Chrome often
// only has the extension to go on.
export const BRAND_DOC_ACCEPT = [
  '.pdf', '.txt', '.docx', '.pptx', '.xlsx',
  ...Object.keys(BRAND_DOC_TYPES),
].join(',')

// 40MB. Brand books run 5-50MB; this covers a 40-page book with full-bleed
// artwork. Above it an in-page PDF frame is unusable anyway, and the signed-URL
// path means our servers never carry the bytes either way.
export const MAX_BRAND_DOC_BYTES = 40 * 1024 * 1024

const BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(BRAND_DOC_TYPES).map(([mime, spec]) => [spec.ext, mime]),
)

/**
 * The file's own type when the browser reports one we accept, else its
 * extension. Browsers hand back '' for .docx and .pptx on plenty of machines,
 * and refusing those would refuse half the real uploads — but the fallback can
 * only ever land on a type already in the allowlist.
 */
export function resolveDocType(file: { name: string; type: string }): string | null {
  if (file.type && BRAND_DOC_TYPES[file.type]) return file.type
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
