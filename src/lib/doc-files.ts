// What every uploaded-file list shares, whatever the files belong to.
//
// No directive: the browser imports it (to refuse a bad file before a 50MB
// upload starts) and Server Actions import it (to enforce the same rule).
// Each feature keeps its OWN type map — brand-docs and project-briefs are
// different buckets with different allowed_mime_types, and one shared list
// would pass a type the bucket then refuses.

export interface DocTypeSpec {
  ext: string
  /** The row's type chip. */
  label: string
  /** True only where a browser has a real renderer. Drives whether "View" exists at all. */
  inline: boolean
  /** Named in the row when it does not. */
  opensIn: string | null
}

export const MB = 1048576

/**
 * The file's own type when the browser reports one the map accepts, else its
 * extension. Browsers hand back '' for .docx and .pptx on plenty of machines —
 * but the fallback can only ever land on a type already in the map.
 */
export function resolveDocTypeIn(
  types: Record<string, DocTypeSpec>,
  file: { name: string; type: string },
  aliases: Record<string, string> = {},
): string | null {
  if (file.type && types[file.type]) return file.type
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  for (const [mime, spec] of Object.entries(types)) if (spec.ext === ext) return mime
  const alias = aliases[ext]
  return alias && types[alias] ? alias : null
}

/**
 * The display name, made safe. Slashes and control characters are stripped —
 * not because they reach the path (the extension comes from the allowlist and
 * the name never builds the path) but because they break the row and
 * Content-Disposition. Unicode letters survive.
 */
export function safeDocNameIn(types: Record<string, DocTypeSpec>, raw: string, contentType: string): string {
  const cleaned = raw
    .replace(/[\\/\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // By code point, for the same reason as str() in project-briefs.ts.
  const capped = Array.from(cleaned).slice(0, 180).join('')
  return capped || `document.${types[contentType]?.ext ?? 'bin'}`
}

/** Content-Disposition is an ASCII header: the SAVED name is folded, the row keeps the real one. */
export const asciiDocName = (name: string): string =>
  name.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_')

/** Ids arrive from the browser in action calls; '..' must not reach a path. */
export const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
