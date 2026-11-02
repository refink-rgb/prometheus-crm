// Revenue metrics over one sheet snapshot. Pure: no Supabase, no `new Date()`.
//
// The unit is a LINE: one client + one service (Noble · MM). Two sheet rows
// for the same client + service are summed into one line.
//
// For a month M, each line is exactly one of:
//   new          — revenue in M, and in no earlier month of the sheet
//   reactivated  — revenue in M, none in M-1, but some before (paused, back)
//   existing     — revenue in M and in M-1
//   churned      — revenue in M-1, none in M (counted at its M-1 amount)
//
// Clients follow the same rules over all their lines at once. The sheet's first
// month has nothing before it, so everything in it reads as new.

import { normalizeClientName } from './sheet'

export interface RevenueLineInput {
  clientName: string
  service: string
  brandId: string | null
  months: Record<string, number>
}

export interface MonthStat {
  month: string
  revenueCents: number
  targetCents: number | null
  newCents: number
  reactivatedCents: number
  existingCents: number
  churnedCents: number
  activeClients: number
  newClients: string[]
  churnedClients: string[]
  /** churned revenue ÷ last month's revenue. Null for the first month. */
  revenueChurnRate: number | null
  /** churned clients ÷ last month's clients. Null for the first month. */
  clientChurnRate: number | null
  /** What last month's lines bill this month ÷ last month's revenue. */
  netRetention: number | null
  byService: Record<string, number>
  /** After the current month: what the sheet expects, not what happened. */
  isForecast: boolean
}

export interface ClientRevenue {
  key: string
  name: string
  brandIds: string[]
  services: string[]
  /** Services that bill in the current month. */
  currentServices: string[]
  prevCents: number
  currentCents: number
  nextCents: number
}

export interface RevenueSummary {
  months: MonthStat[]
  currentMonth: string
  current: MonthStat | null
  previous: MonthStat | null
  next: MonthStat | null
  clients: ClientRevenue[]
  services: string[]
}

interface Line {
  clientKey: string
  clientName: string
  service: string
  brandIds: Set<string>
  months: Record<string, number>
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function computeRevenue(
  inputs: readonly RevenueLineInput[],
  months: readonly string[],
  targets: Record<string, number>,
  currentMonth: string,
): RevenueSummary {
  // Merge rows into lines.
  const lines = new Map<string, Line>()
  for (const r of inputs) {
    const clientKey = normalizeClientName(r.clientName)
    const k = `${clientKey}|${r.service}`
    let line = lines.get(k)
    if (!line) {
      line = { clientKey, clientName: r.clientName, service: r.service, brandIds: new Set(), months: {} }
      lines.set(k, line)
    }
    if (r.brandId) line.brandIds.add(r.brandId)
    for (const [m, cents] of Object.entries(r.months)) line.months[m] = (line.months[m] ?? 0) + cents
  }
  const all = [...lines.values()]
  const amt = (l: Line, m: string | undefined) => (m ? l.months[m] ?? 0 : 0)
  const clientAmt = (clientKey: string, m: string | undefined) =>
    sum(all.filter(l => l.clientKey === clientKey).map(l => amt(l, m)))
  const clientKeys = [...new Set(all.map(l => l.clientKey))]
  const nameOf = new Map(all.map(l => [l.clientKey, l.clientName]))

  const stats: MonthStat[] = months.map((m, i) => {
    const prev = i > 0 ? months[i - 1] : undefined
    const earlier = months.slice(0, Math.max(0, i - 1))
    let newCents = 0, reactivatedCents = 0, existingCents = 0, churnedCents = 0, retainedFromPrev = 0
    const byService: Record<string, number> = {}
    for (const l of all) {
      const now = amt(l, m)
      const before = amt(l, prev)
      if (before > 0) retainedFromPrev += now
      if (now > 0) {
        byService[l.service || 'Other'] = (byService[l.service || 'Other'] ?? 0) + now
        if (before > 0) existingCents += now
        else if (earlier.some(e => amt(l, e) > 0)) reactivatedCents += now
        else newCents += now
      } else if (before > 0) {
        churnedCents += before
      }
    }
    const revenueCents = newCents + reactivatedCents + existingCents
    const prevRevenue = prev ? sum(all.map(l => amt(l, prev))) : 0

    const activeNow = clientKeys.filter(c => clientAmt(c, m) > 0)
    const activePrev = prev ? clientKeys.filter(c => clientAmt(c, prev) > 0) : []
    const everBefore = (c: string) => months.slice(0, i).some(e => clientAmt(c, e) > 0)
    const newClients = activeNow.filter(c => !everBefore(c)).map(c => nameOf.get(c)!)
    const churnedClients = activePrev.filter(c => clientAmt(c, m) === 0).map(c => nameOf.get(c)!)

    return {
      month: m,
      revenueCents,
      targetCents: targets[m] ?? null,
      newCents,
      reactivatedCents,
      existingCents,
      churnedCents,
      activeClients: activeNow.length,
      newClients,
      churnedClients,
      revenueChurnRate: prev && prevRevenue > 0 ? churnedCents / prevRevenue : null,
      clientChurnRate: prev && activePrev.length > 0 ? churnedClients.length / activePrev.length : null,
      netRetention: prev && prevRevenue > 0 ? retainedFromPrev / prevRevenue : null,
      byService,
      isForecast: m > currentMonth,
    }
  })

  const idx = months.indexOf(currentMonth)
  const prevKey = idx > 0 ? months[idx - 1] : undefined
  const nextKey = idx >= 0 && idx < months.length - 1 ? months[idx + 1] : undefined

  const clients: ClientRevenue[] = clientKeys.map(c => {
    const mine = all.filter(l => l.clientKey === c)
    return {
      key: c,
      name: nameOf.get(c)!,
      brandIds: [...new Set(mine.flatMap(l => [...l.brandIds]))],
      services: [...new Set(mine.map(l => l.service).filter(Boolean))].sort(),
      currentServices: idx >= 0
        ? [...new Set(mine.filter(l => amt(l, currentMonth) > 0).map(l => l.service).filter(Boolean))].sort()
        : [],
      prevCents: clientAmt(c, prevKey),
      currentCents: idx >= 0 ? clientAmt(c, currentMonth) : 0,
      nextCents: clientAmt(c, nextKey),
    }
  })

  return {
    months: stats,
    currentMonth,
    current: idx >= 0 ? stats[idx] : null,
    previous: idx > 0 ? stats[idx - 1] : null,
    next: nextKey ? stats[idx + 1] : null,
    clients,
    services: [...new Set(all.map(l => l.service || 'Other'))].sort(),
  }
}
