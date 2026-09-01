import type { ProjectProduct, ProjectCompetitor, ProjectTopPerformer, CopyApprovals, CopyApprovalLine, CopyApprovalLog } from './types'

// Reading the Creatives tab's two repeating lists.
//
// Pure, no React, so the bundle API route and markdown-export can both use it.
//
// Everything here is a NORMALISER, not a cast. These columns are JSONB: Postgres
// guarantees only that the value is an array (see the migration's CHECK), so the
// element shape has to be established at the boundary. A stored
// "javascript:alert(1)" would otherwise be handed straight to an href.

/**
 * Split a legacy product_featured string.
 *
 * ';' ONLY. Two projects contain a '|', but in both the pipe sits inside a
 * product NAME ("Tea Bento Box | 6-pack") and the row's real delimiter is still
 * the semicolon — splitting on '|' invents a product called "6-pack".
 */
export const splitSkus = (raw: string | null | undefined): string[] =>
  raw ? raw.split(';').map(x => x.trim()).filter(Boolean) : []

// Only http(s) survives. Anything else becomes null rather than an href.
const safeUrl = (v: unknown): string | null =>
  typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const mintId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `p-${Math.random().toString(36).slice(2)}`

// Deliberately `unknown`, not ProjectProduct[]. These are JSONB columns: the
// declared type on Project describes what we WRITE, and taking it as an input
// type here would be claiming the very guarantee this function exists to supply.
// It also lets narrower row types (the bundle API's ProjectRow) pass straight in.
type ProductSource = { products?: unknown; product_featured?: string | null }
type CompetitorSource = { competitors?: unknown }

/**
 * Structured rows when they exist, otherwise the legacy name list.
 *
 * The fallback is permanent, not transitional: offer-to-production still mints
 * new projects by copying product_featured text with no structured list behind
 * it, so there will always be projects that have names and nothing else.
 */
export function readProducts(p: ProductSource): ProjectProduct[] {
  const raw = p.products as unknown
  if (Array.isArray(raw)) {
    return raw
      .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
      .map(el => ({
        id: str(el.id) || mintId(),
        name: str(el.name),
        url: safeUrl(el.url),
        assets_url: safeUrl(el.assets_url),
        group: str(el.group) || null,
        image_url: safeUrl(el.image_url),
      }))
      .filter(x => x.name.length > 0)
  }
  return splitSkus(p.product_featured).map(name => ({
    id: `legacy-${name}`, name, url: null, assets_url: null, group: null, image_url: null,
  }))
}

/** No fallback: nothing in competitor_reference is machine-parseable. */
export function readCompetitors(p: CompetitorSource): ProjectCompetitor[] {
  const raw = p.competitors as unknown
  if (!Array.isArray(raw)) return []
  return raw
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
    .map(el => ({
      id: str(el.id) || mintId(),
      name: str(el.name),
      site_url: safeUrl(el.site_url),
      motion_url: safeUrl(el.motion_url),
    }))
    .filter(x => x.name.length > 0)
}

export function readTopPerformers(p: { top_performers?: unknown }): ProjectTopPerformer[] {
  const raw = p.top_performers as unknown
  if (!Array.isArray(raw)) return []
  return raw
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
    .map(el => ({
      id: str(el.id) || mintId(),
      name: str(el.name),
      motion_url: safeUrl(el.motion_url),
      link: safeUrl(el.link),
    }))
    .filter(x => x.name.length > 0)
}

/**
 * Products in display order, bucketed by group.
 *
 * Ungrouped products come LAST under a null key, not first: on a project that
 * has bundles, the stragglers are the exception and should read as one.
 * Group order follows first appearance in the array, so reordering in the editor
 * reorders the groups too — there is no second ordering field to keep in sync.
 */
export function groupProducts(list: ProjectProduct[]): { group: string | null; items: ProjectProduct[] }[] {
  const buckets = new Map<string | null, ProjectProduct[]>()
  for (const item of list) {
    const key = item.group || null
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const named = [...buckets.entries()].filter(([k]) => k !== null)
  const loose = buckets.get(null)
  return [
    ...named.map(([group, items]) => ({ group, items })),
    ...(loose ? [{ group: null, items: loose }] : []),
  ]
}

/** What the writer mirrors back into product_featured. */
export const productNamesLine = (list: ProjectProduct[]): string | null =>
  list.length ? list.map(x => x.name).join('; ') : null

/**
 * True when product_featured was edited elsewhere and no longer agrees with the
 * structured list. The live project page still has a free-text product input,
 * and once a structured list exists the read layer prefers it — so an edit over
 * there becomes invisible here. This detects that; nothing prevents it yet.
 */
export function productsDrifted(p: ProductSource): boolean {
  if (!Array.isArray(p.products)) return false
  // An empty mirror is not drift. It is what a project looks like before the
  // mirror has ever been written — warning about it would put an orange line on
  // every project that got its list from anywhere but this editor.
  if (!p.product_featured?.trim()) return false
  const a = readProducts(p).map(x => x.name).sort()
  const b = splitSkus(p.product_featured).sort()
  return a.length !== b.length || a.some((v, i) => v !== b[i])
}

/** The exact text an offer summary was generated from, for cache invalidation. */
export const offerSource = (p: { offer?: string | null; offer_description?: string | null }): string =>
  [p.offer, p.offer_description].filter(Boolean).join('\n').trim()


/**
 * Copy sign-off, normalised.
 *
 * Same rule as the product lists: JSONB guarantees only the outer shape, so the
 * contents are established here rather than cast. An unknown status is dropped
 * rather than rendered — a line whose verdict cannot be read is an unreviewed
 * line, not an approved one.
 */
export function readCopyApprovals(p: { copy_approvals?: unknown }): CopyApprovals {
  const raw = p.copy_approvals as Record<string, unknown> | null | undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { lines: [], log: [] }

  const lines: CopyApprovalLine[] = (Array.isArray(raw.lines) ? raw.lines : [])
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
    .map(el => ({
      text: str(el.text),
      status: el.status === 'approved' || el.status === 'rejected' ? el.status : null,
      by: str(el.by) || null,
      at: str(el.at),
    }))
    .filter((x): x is CopyApprovalLine => !!x.status && x.text.length > 0)

  const log: CopyApprovalLog[] = (Array.isArray(raw.log) ? raw.log : [])
    .filter((el): el is Record<string, unknown> => !!el && typeof el === 'object')
    .map(el => ({
      at: str(el.at),
      by: str(el.by) || null,
      approved: typeof el.approved === 'number' ? el.approved : 0,
      rejected: typeof el.rejected === 'number' ? el.rejected : 0,
    }))
    .filter(x => x.at.length > 0)

  return { lines, log }
}

/** Verdict for one line of copy, or null when it has not been reviewed. */
export function verdictFor(approvals: CopyApprovals, text: string): CopyApprovalLine | null {
  const key = text.trim()
  return approvals.lines.find(l => l.text.trim() === key) ?? null
}
