// Hypercare brands — accounts where ad copy must come from a named person
// rather than the CRM's Gemini generator.
//
// Noble is the first: its copy is written by the growth strategist and
// AI-generated decks were going out under-specified (generic lines that
// ignored the brief). Rather than police it socially, the Generate Copy path
// is closed for these brands and points at the owner instead.
//
// Keyed by lower-cased brand name so adding a brand is a one-line change and
// needs no migration. Matching is on the name because that is what every
// surface (project page, copy panel, server action) already has to hand.

export interface HypercareRule {
  /** Shown on the project banner and in place of generated copy. */
  contact: string
  /** One line explaining why the brand is in hypercare. */
  reason: string
}

const HYPERCARE: Record<string, HypercareRule> = {
  noble: {
    contact: 'Lucas Dias',
    reason: 'Ad copy for this brand is written by the growth strategist, not generated.',
  },
}

export function hypercareFor(brandName: string | null | undefined): HypercareRule | null {
  if (!brandName) return null
  return HYPERCARE[brandName.trim().toLowerCase()] ?? null
}

export function isHypercare(brandName: string | null | undefined): boolean {
  return hypercareFor(brandName) !== null
}

/** The message shown when someone tries to generate copy for a hypercare brand. */
export function hypercareCopyMessage(rule: HypercareRule): string {
  return `Reach out to ${rule.contact} for ad copy`
}
