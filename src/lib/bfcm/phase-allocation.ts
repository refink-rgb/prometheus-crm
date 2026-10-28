import { CATEGORIES, effectivePrePercent, type Category, type PlanSnapshot } from './model'

export type PhaseAllocationRow = { id: Category; label: string; pre: number; bf: number; total: number }
export type PhaseAllocationGroup = { id: 'statics' | 'motion'; label: string; rows: PhaseAllocationRow[]; pre: number; bf: number; total: number }
export type PhaseAllocation = { rows: PhaseAllocationRow[]; groups: PhaseAllocationGroup[]; pre: number; bf: number; total: number; prePercent: number }

/** Derived phase quantities, not independently contracted quotas. Never changes the snapshot. */
export function phaseAllocation(snapshot: Pick<PlanSnapshot, 'allocation' | 'prePercent' | 'noPreBf'>): PhaseAllocation {
  const prePercent = effectivePrePercent(snapshot)
  if (!Number.isInteger(prePercent) || prePercent < 0 || prePercent > 100) throw new Error('Invalid phase split.')
  const rows = CATEGORIES.map(category => {
    const total = snapshot.allocation[category.id]
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid creative quantity.')
    return { ...category, total, pre: Math.floor(total * prePercent / 100), bf: 0 }
  })
  const total = rows.reduce((sum, row) => sum + row.total, 0)
  if (!Number.isSafeInteger(total * 100)) throw new Error('Creative quantity is too large.')
  const pre = Math.round(total * prePercent / 100)
  const remaining = pre - rows.reduce((sum, row) => sum + row.pre, 0)
  // Integer remainders avoid floating-point tie ambiguity; original category order breaks ties.
  const order = rows.map((row, index) => ({ index, remainder: row.total * prePercent % 100 }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let i = 0; i < remaining; i++) rows[order[i].index].pre++
  for (const row of rows) row.bf = row.total - row.pre
  const groups: PhaseAllocationGroup[] = [
    { id: 'statics', label: 'Statics', rows: rows.slice(0, 3), pre: 0, bf: 0, total: 0 },
    { id: 'motion', label: 'Motion', rows: rows.slice(3), pre: 0, bf: 0, total: 0 },
  ]
  for (const group of groups) for (const row of group.rows) {
    group.pre += row.pre; group.bf += row.bf; group.total += row.total
  }
  return { rows, groups, pre, bf: total - pre, total, prePercent }
}
