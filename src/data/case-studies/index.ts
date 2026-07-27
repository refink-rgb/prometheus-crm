import type { CaseStudy } from './types'
import giftWithPurchaseMeta from './c37ad0a3613be6dcaeea9be961dcdf3deec6e6ac'

export type { CaseStudy } from './types'

// ─── Case-study registry ─────────────────────────────────────────────────────
//
// Publishing the next showcase = add one data file above + one entry here. The
// route (`src/app/(public)/showcase/[slug]/page.tsx`) and every component read
// only from this registry — no component changes per case study.
//
// Keys are the unguessable hex slug (= the public route). Never key by anything
// derived from the brand.

const CASE_STUDIES: CaseStudy[] = [giftWithPurchaseMeta]

const BY_SLUG: Record<string, CaseStudy> = Object.fromEntries(
  CASE_STUDIES.map((cs) => [cs.slug, cs]),
)

export function getCaseStudy(slug: string): CaseStudy | undefined {
  return BY_SLUG[slug]
}

export function getAllCaseStudies(): CaseStudy[] {
  return CASE_STUDIES
}

export function getAllCaseStudySlugs(): string[] {
  return CASE_STUDIES.map((cs) => cs.slug)
}
