import {
  OFFER_STAGE_LABELS,
  offerMonthLabel,
  type OfferCard,
  type OfferStage,
  type Project,
} from './types'

export type OfferHistoryCard = OfferCard & { brands: { id: string; name: string } }

export type OfferHistoryProject = Pick<Project,
  | 'id'
  | 'brand_id'
  | 'name'
  | 'due_date'
  | 'created_at'
  | 'marketing_moment'
  | 'source_offer_card_id'
  | 'offer_dynamics_type'
  | 'offer'
  | 'offer_description'
  | 'product_featured'
  | 'retail_price'
  | 'page_type'
  | 'discount'
  | 'tiered_offer'
  | 'shopify_coupon_code'
  | 'is_complete'
  | 'lp_stage'
  | 'creatives_stage'
> & { brands: { id: string; name: string } }

export interface OfferHistoryEntry {
  key: string
  source: 'offer_cycle' | 'legacy_production'
  id: string
  brandId: string
  brandName: string
  title: string
  description: string | null
  /** Why the offer ran — the problem it set out to solve. Production-only
   *  records predate the field, so they carry null. */
  objective: string | null
  mechanics: string | null
  product: string | null
  retailPrice: string | null
  pageType: string | null
  targetMonth: string
  momentSlot: 1 | 2 | null
  status: string
  offerStage: OfferStage | null
  ownerId: string | null
  href: string
  productionProjectId: string | null
  productionHref: string | null
  createdAt: string
}

function firstText(...values: Array<string | null | undefined>): string | null {
  return values.find(value => value?.trim())?.trim() ?? null
}

function productionStatus(project: OfferHistoryProject): string {
  if (project.is_complete) return 'Completed'
  if (project.lp_stage === 'live' && project.creatives_stage === 'live') return 'Live'
  return 'In production'
}

/**
 * One searchable history across the purpose-built Offer Cycle and older
 * Production cards. A Production card generated from an Offer card enriches
 * that entry with a link instead of appearing as a duplicate row.
 */
export function buildOfferHistory(
  cards: OfferHistoryCard[],
  projects: OfferHistoryProject[],
): OfferHistoryEntry[] {
  const projectsBySource = new Map(
    projects
      .filter(project => project.source_offer_card_id)
      .map(project => [project.source_offer_card_id as string, project]),
  )
  const offerIds = new Set(cards.map(card => card.id))

  const entries: OfferHistoryEntry[] = cards.map(card => {
    const production = projectsBySource.get(card.id)
    const productionId = card.derived_production_card_id ?? production?.id ?? null
    return {
      key: `offer:${card.id}`,
      source: 'offer_cycle',
      id: card.id,
      brandId: card.brand_id,
      brandName: card.brands.name,
      title: firstText(card.offer, card.offer_description, card.name) as string,
      description: card.offer_description,
      objective: card.problem_statement,
      mechanics: card.offer_dynamics_type,
      product: card.product_featured,
      retailPrice: card.retail_price,
      pageType: card.page_type,
      targetMonth: card.target_month,
      momentSlot: card.moment_slot,
      status: OFFER_STAGE_LABELS[card.stage],
      offerStage: card.stage,
      ownerId: card.assigned_to,
      href: `/offers/${card.id}`,
      productionProjectId: productionId,
      productionHref: productionId ? `/brands/${card.brand_id}/projects/${productionId}` : null,
      createdAt: card.created_at,
    }
  })

  for (const project of projects) {
    if (project.source_offer_card_id && offerIds.has(project.source_offer_card_id)) continue
    const month = `${project.due_date.slice(0, 7)}-01`
    entries.push({
      key: `production:${project.id}`,
      source: 'legacy_production',
      id: project.id,
      brandId: project.brand_id,
      brandName: project.brands.name,
      title: firstText(project.offer, project.offer_description, project.name) as string,
      description: project.offer_description,
      objective: null,
      mechanics: firstText(project.offer_dynamics_type, project.tiered_offer, project.discount),
      product: project.product_featured,
      retailPrice: project.retail_price,
      pageType: project.page_type,
      targetMonth: month,
      momentSlot: project.marketing_moment,
      status: productionStatus(project),
      offerStage: null,
      ownerId: null,
      href: `/brands/${project.brand_id}/projects/${project.id}`,
      productionProjectId: project.id,
      productionHref: `/brands/${project.brand_id}/projects/${project.id}`,
      createdAt: project.created_at,
    })
  }

  return entries.sort((a, b) =>
    b.targetMonth.localeCompare(a.targetMonth)
    || (b.momentSlot ?? 0) - (a.momentSlot ?? 0)
    || a.brandName.localeCompare(b.brandName),
  )
}

export interface OfferCompletionItem {
  label: string
  done: boolean
  tab: 'offer' | 'product'
}

export function offerCompletion(card: OfferCard): {
  items: OfferCompletionItem[]
  complete: number
  total: number
  percent: number
} {
  const present = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value)
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
  }
  const items: OfferCompletionItem[] = [
    { label: 'Problem statement', done: present(card.problem_statement), tab: 'offer' },
    { label: 'Offer mechanics', done: present(card.offer_dynamics_type) && present(card.offer), tab: 'offer' },
    { label: 'Offer description', done: present(card.offer_description), tab: 'offer' },
    { label: 'Guardrails', done: present(card.guardrails), tab: 'offer' },
    { label: 'Success criteria', done: present(card.success_metric) && present(card.success_target), tab: 'offer' },
    { label: 'Product and price', done: present(card.product_featured) && present(card.retail_price), tab: 'product' },
    { label: 'Page type', done: present(card.page_type), tab: 'product' },
    { label: 'Creative inputs', done: present(card.competitor_reference) || present(card.client_ad_inspiration) || present(card.product_images_link), tab: 'product' },
  ]
  const complete = items.filter(item => item.done).length
  return { items, complete, total: items.length, percent: Math.round((complete / items.length) * 100) }
}

export function historyMonthLabel(entry: OfferHistoryEntry): string {
  return offerMonthLabel(entry.targetMonth)
}
