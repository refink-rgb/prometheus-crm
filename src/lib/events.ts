// Prometheus Evolution — Phase 1 event logger.
//
// Append-only instrumentation over the existing pipeline. Two hard rules:
//   1. Logging must NEVER break the operation it observes — every failure is
//      caught and logged to the server console, never thrown.
//   2. All writes go through the service-role client: server actions called
//      from token-gated pages (/review/[token]) have no auth session, and the
//      events table deliberately has no PostgREST insert policy.
//
// Kill switch: set PROMETHEUS_EVENTS_DISABLED=1 in Vercel env to silence all
// emission (and the pre-update reads that feed it) without a deploy revert.

import { createServiceClient } from './supabase/service'

export type PipelineEventType =
  | 'stage_changed'
  | 'assigned'
  | 'sent_to_client'
  | 'client_responded'
  | 'slip_recorded'

// Event-log track ids ('creative', singular) — distinct from the
// 'lp_stage' | 'creatives_stage' column names used by updateProjectStage.
export type EventTrack = 'lp' | 'creative'

export const STAGE_COLUMN_TO_TRACK: Record<'lp_stage' | 'creatives_stage', EventTrack> = {
  lp_stage: 'lp',
  creatives_stage: 'creative',
}

export interface PipelineEventInput {
  event_type: PipelineEventType
  card_kind?: 'production' | 'offer'
  card_id: string
  brand_id?: string | null
  track?: EventTrack | null
  from_stage?: string | null
  to_stage?: string | null
  actor_id?: string | null
  actor_label: string
  payload?: Record<string, unknown>
}

export function eventsEnabled(): boolean {
  return process.env.PROMETHEUS_EVENTS_DISABLED !== '1'
}

// Actor fields from a Supabase auth user (server actions always have one when
// canEdit passed). Token-gated actions pass the 'client' sentinel explicitly.
export function actorFromUser(user: { id: string; email?: string | null }): {
  actor_id: string
  actor_label: string
} {
  return { actor_id: user.id, actor_label: user.email ?? user.id }
}

export async function logEvents(events: PipelineEventInput[]): Promise<void> {
  if (!eventsEnabled() || events.length === 0) return
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('pipeline_events').insert(
      events.map(e => ({
        event_type: e.event_type,
        card_kind: e.card_kind ?? 'production',
        card_id: e.card_id,
        brand_id: e.brand_id ?? null,
        track: e.track ?? null,
        from_stage: e.from_stage ?? null,
        to_stage: e.to_stage ?? null,
        actor_id: e.actor_id ?? null,
        actor_label: e.actor_label,
        payload: e.payload ?? {},
      }))
    )
    if (error) console.error('[events] insert failed:', error.message, JSON.stringify(events))
  } catch (err) {
    console.error('[events] logging threw:', err)
  }
}

// Replay a card's stage_changed events in order and return the resulting stage
// per track. NULL means "no events for that track yet" — expected for cards
// that predate Phase 1 (no backfill, by design). Used by the validation
// endpoint (/api/events/replay) to prove the log matches live card state.
export async function replayStageState(cardId: string): Promise<{
  lp: string | null
  creative: string | null
  event_count: number
}> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('pipeline_events')
    .select('track, to_stage')
    .eq('card_id', cardId)
    .eq('event_type', 'stage_changed')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Replay query failed: ${error.message}`)

  const state: { lp: string | null; creative: string | null } = { lp: null, creative: null }
  for (const row of (data ?? []) as Array<{ track: string | null; to_stage: string | null }>) {
    if (row.track === 'lp' || row.track === 'creative') state[row.track] = row.to_stage
  }
  return { ...state, event_count: (data ?? []).length }
}
