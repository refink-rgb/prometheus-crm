/** Production tasks after the plan: who makes what by when. Pure; safe for client and server. */
import { CATEGORIES, type Allocation, type Category, type PlanSnapshot } from './model'
import { phaseAllocation } from './phase-allocation'

export type StepKind = 'review' | 'samples' | 'statics' | 'motion' | 'check' | 'task' | 'calibration_statics' | 'calibration_motion'
export type StepStatus = 'todo' | 'in_progress' | 'waiting_client' | 'done' | 'not_required'
export type Phase = 'pre' | 'bf'
export type ProductionStep = {
  id: string; plan_slug: string; parent_id: string | null; sort_order: number; kind: string
  title: string; plan_key: string | null; due_date: string | null; status: string
}
export type Person = { id: string; name: string }
export type TaskNode = ProductionStep & { assignees: string[]; commentCount: number; children: TaskNode[] }

export const DEFAULT_STEPS: { kind: Exclude<StepKind, 'task' | 'calibration_statics' | 'calibration_motion'>; title: string; sort_order: number }[] = [
  { kind: 'review', title: 'Review client plan & split', sort_order: 1 },
  { kind: 'samples', title: 'Calibration samples for the client', sort_order: 2 },
  { kind: 'statics', title: 'Make statics', sort_order: 3 },
  { kind: 'motion', title: 'Make motion', sort_order: 4 },
  { kind: 'check', title: 'Internal check & send', sort_order: 5 },
]
/** Calibration's two tracks, like Landing Page and Creatives on a Moments project. Each is a subtask of the samples task. */
export const CALIBRATION_TRACKS = [
  { id: 'statics', label: 'Statics', kind: 'calibration_statics', title: 'Statics samples', sort_order: 1 },
  { id: 'motion', label: 'Motion', kind: 'calibration_motion', title: 'Motion samples', sort_order: 2 },
] as const
export const STEP_STATUSES: { id: StepStatus; label: string }[] = [
  { id: 'todo', label: 'Not started' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'waiting_client', label: 'Waiting on client' },
  { id: 'done', label: 'Done' },
  { id: 'not_required', label: 'Not required' },
]
/** Unknown values (a newer status from another branch) show as text instead of crashing. */
export function stepStatusLabel(status: string): string { return STEP_STATUSES.find(s => s.id === status)?.label ?? status }
export const isStepStatus = (value: unknown): value is StepStatus => STEP_STATUSES.some(s => s.id === value)
/** Finished for progress: done, or not needed for this brand. */
export const isClosed = (status: string) => status === 'done' || status === 'not_required'

/** Which of the plan's categories a top-level step makes. */
export const KIND_CATEGORIES: Partial<Record<string, Category[]>> = {
  statics: ['textOffer', 'refreshedStatic', 'newStatic'],
  motion: ['refreshedVideo', 'motionGraphics'],
}
export const PHASE_LABEL: Record<Phase, string> = { pre: 'Pre-BF', bf: 'Black Friday' }
const categoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? id

export function parsePlanKey(key: string | null): { category: Category; phase: Phase } | null {
  const [category, phase] = (key ?? '').split(':')
  if (!CATEGORIES.some(c => c.id === category) || (phase !== 'pre' && phase !== 'bf')) return null
  return { category: category as Category, phase }
}
export const planKeyTitle = (key: string) => {
  const parsed = parsePlanKey(key)
  return parsed ? `${categoryLabel(parsed.category)} · ${PHASE_LABEL[parsed.phase]}` : key
}

type SplitInput = Pick<PlanSnapshot, 'allocation' | 'prePercent' | 'noPreBf'>
/** Quantity for a plan-linked subtask, read from the plan as it is now. */
export function planKeyCount(key: string | null, plan: SplitInput): number | null {
  const parsed = parsePlanKey(key)
  if (!parsed) return null
  const row = phaseAllocation(plan).rows.find(r => r.id === parsed.category)
  return row ? row[parsed.phase] : null
}
/** The subtasks "Split by plan" makes for a step: every category × phase with something to make. */
export function planSplitFor(kind: string, plan: SplitInput): { plan_key: string; title: string; count: number }[] {
  const categories = KIND_CATEGORIES[kind]
  if (!categories) return []
  const rows = phaseAllocation(plan).rows
  return categories.flatMap(category => (['pre', 'bf'] as Phase[]).flatMap(phase => {
    const count = rows.find(r => r.id === category)?.[phase] ?? 0
    const plan_key = `${category}:${phase}`
    return count > 0 ? [{ plan_key, title: planKeyTitle(plan_key), count }] : []
  }))
}

/** Counts come from the plan's current split, so they never drift from it. */
export function productionCounts(allocation: Allocation) {
  return {
    statics: { total: allocation.textOffer + allocation.refreshedStatic + allocation.newStatic, detail: `${allocation.textOffer} text-only · ${allocation.refreshedStatic} refreshed · ${allocation.newStatic} new` },
    motion: { total: allocation.refreshedVideo + allocation.motionGraphics, detail: `${allocation.refreshedVideo} refreshed · ${allocation.motionGraphics} motion graphics` },
  }
}

export function buildTaskTree(steps: ProductionStep[], assignees: { step_id: string; profile_id: string }[], commentCounts: Record<string, number>): TaskNode[] {
  const nodes = new Map<string, TaskNode>(steps.map(s => [s.id, { ...s, assignees: [], commentCount: commentCounts[s.id] ?? 0, children: [] }]))
  for (const a of assignees) nodes.get(a.step_id)?.assignees.push(a.profile_id)
  const roots: TaskNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null
    if (parent) parent.children.push(node); else roots.push(node)
  }
  const sort = (list: TaskNode[]) => { list.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)); list.forEach(n => sort(n.children)) }
  sort(roots)
  return roots
}

/** A task with subtasks takes its status from them, so the two can never disagree. */
export function effectiveStatus(node: Pick<TaskNode, 'status' | 'children'>): string {
  if (!node.children.length) return node.status
  const all = node.children.map(effectiveStatus)
  if (all.every(s => s === 'not_required')) return 'not_required'
  // Subtasks marked not required drop out; the rest decide.
  const statuses = all.filter(s => s !== 'not_required')
  if (statuses.every(s => s === 'done')) return 'done'
  if (statuses.every(s => s === 'todo')) return 'todo'
  if (statuses.every(s => s === 'done' || s === 'waiting_client')) return 'waiting_client'
  return 'in_progress'
}

/** First unfinished top-level task, for the brand card on the list page. */
export function productionSummary(roots: TaskNode[]) {
  const done = roots.filter(s => isClosed(effectiveStatus(s))).length
  const next = roots.find(s => !isClosed(effectiveStatus(s))) ?? null
  return { done, total: roots.length, next }
}

/** @Name tokens in a comment that match a teammate; longest names first so "Ana Lu" beats "Ana". */
export function mentionedIds(text: string, people: Person[]): string[] {
  return [...people].sort((a, b) => b.name.length - a.name.length).filter(p => text.includes(`@${p.name}`)).map(p => p.id)
}
