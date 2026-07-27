import type { CaseStudy } from '@/data/case-studies/types'

export type Stage = 'brief' | 'in_progress' | 'internal_review' | 'client_review' | 'revisions' | 'live' | 'done'

export type PipelineStatus = 'intro_contact' | 'discovery_call' | 'offer_prep' | 'active'

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  intro_contact:   'Intro Contact',
  discovery_call:  'Discovery Call',
  offer_prep:      'Offer Prep',
  active:          'Active Client',
}

export const PIPELINE_STATUS_ORDER: PipelineStatus[] = [
  'intro_contact', 'discovery_call', 'offer_prep', 'active',
]

export const PAGE_TYPE_OPTIONS = [
  'Listicle',
  'Bundle Builder',
  'Collection Page',
  'Generic Offer Page',
] as const

export type PageType = typeof PAGE_TYPE_OPTIONS[number]

// A row in `profiles` — the team roster, mirrored from auth.users by the
// on_auth_user_created trigger (see 20260715_add_profiles_and_editor_assignment).
// Replaces the old hardcoded DESIGNERS array: editors are real users now, and a
// project's editor columns are FKs to this table.
export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'member'
  // Grants access to the CRM. Source of truth for canEdit().
  can_edit: boolean
  // Capability flags — each editor picker lists only the people it applies to.
  is_lp_editor: boolean
  is_creative_editor: boolean
  created_at: string
}

// In-app notification (assignment + @mention). See supabase migration
// 20260722_add_notifications.sql and src/lib/notifications.ts.
export interface NotificationRow {
  id: string
  recipient_id: string
  actor_id: string | null
  actor_label: string
  type: 'assigned' | 'mentioned'
  project_id: string | null
  brand_id: string | null
  comment_id: string | null
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

// The two assignable tracks, mirroring the lp_stage / creatives_stage split.
export type EditorTrack = 'lp' | 'creative'

export const EDITOR_TRACK_META: Record<EditorTrack, {
  label: string
  column: 'lp_editor_id' | 'creative_editor_id'
  capability: 'is_lp_editor' | 'is_creative_editor'
}> = {
  lp: { label: 'LP Editor', column: 'lp_editor_id', capability: 'is_lp_editor' },
  creative: { label: 'Creative Editor', column: 'creative_editor_id', capability: 'is_creative_editor' },
}

// Display name for a profile — full_name is seeded from the email prefix by the
// DB trigger, but can be null if a row was created by hand.
export function profileName(p: Profile): string {
  return p.full_name?.trim() || p.email.split('@')[0]
}

// Profiles eligible for a given track's picker. Lives here rather than in
// lib/profiles.ts because client components need it, and that module imports
// the server-only Supabase client.
export function editorsFor(
  profiles: Profile[],
  capability: 'is_lp_editor' | 'is_creative_editor',
): Profile[] {
  return profiles.filter(p => p[capability])
}

// LP/Creative editors are a job function, not an access level — they still
// pass canEdit() and can use the CRM, but financial figures (MRR, /financials)
// aren't relevant to their role and shouldn't be shown to them.
export function isJobEditor(profile: Profile | null | undefined): boolean {
  return !!profile && (profile.is_lp_editor || profile.is_creative_editor)
}

export interface Brand {
  id: string
  name: string
  website: string
  is_active: boolean
  is_trial: boolean
  monthly_retainer: number | null
  start_date: string | null
  growth_strategist: string | null
  profit_engineer: string | null
  pipeline_status: PipelineStatus
  client_number: number | null
  brand_notes: string | null
  onboarding_transcript: string | null
  client_token: string | null
  created_at: string
  created_by: string
}

export interface Journey {
  id: string
  brand_id: string
  name: string
  created_at: string
}

export interface Project {
  id: string
  brand_id: string
  name: string
  // Launch (LIVE) target date. Per-stage targets live in the stage_*_due_date columns.
  due_date: string
  // Per-stage planning targets (informational — never gate advancement).
  stage_brief_due_date: string | null
  stage_in_progress_due_date: string | null
  stage_internal_review_due_date: string | null
  stage_client_review_due_date: string | null
  drive_folder_url: string | null
  // offer description step
  offer_description: string | null
  // Superseded by competitor_reference + client_ad_inspiration. Kept for legacy reads.
  inspiration: string | null
  // Superseded by offer_dynamics_type + offer_dynamics_detail. Kept for legacy reads.
  offer_type: string | null
  offer: string | null
  discount: string | null
  tiered_offer: string | null
  headline: string | null
  body_copy: string | null
  supporting_message: string | null
  cta: string | null
  // legacy / unused but kept for DB compat
  font: string | null
  author: string | null
  target_audience: string | null
  notes: string | null
  // Legacy: a bare name ('Janella') from the removed DESIGNERS array. Superseded
  // by creative_editor_id. Still written by the DB (not by the app) and kept as
  // the rollback path until a later cleanup drops the column.
  assigned_designer: string | null
  // Editor assignment — FKs to profiles.id. Null = unassigned.
  lp_editor_id: string | null
  creative_editor_id: string | null
  // journey & moment
  journey_id: string | null
  marketing_moment: 1 | 2 | null
  // Offer Cycle linkage — set only on cards auto-created from an approved
  // offer (Phase 3 Trigger B). Manual cards keep this null.
  source_offer_card_id: string | null
  page_type: string | null
  product_featured: string | null
  product_description: string | null
  // Creatives-only brief fields
  retail_price: string | null
  offer_dynamics_type: string | null
  offer_dynamics_detail: string | null
  competitor_reference: string | null
  client_ad_inspiration: string | null
  ad_copy_primary_text: string | null
  ad_copy_description: string | null
  ad_copy_url: string | null
  ad_headlines: string[] | null
  ad_subcopies: string[] | null
  ad_eyebrows: string[] | null
  product_images_link: string | null
  needs_revisions: boolean
  // offer lock
  offer_locked: boolean
  offer_locked_at: string | null
  offer_locked_by: string | null
  // client review
  share_token: string | null
  client_approved: boolean
  lp_approved: boolean
  creatives_approved: boolean
  // pipeline
  lp_stage: Stage
  creatives_stage: Stage
  lp_url: string | null
  creatives_notes: string | null
  shopify_coupon_code: string | null
  // Motion share link holding the videos the static editors work on
  motion_link: string | null
  is_complete: boolean
  created_at: string
  created_by: string
  brand?: Brand
  images?: ProjectImage[]
  journey?: Journey
}

export interface ProjectImage {
  id: string
  project_id: string
  storage_path: string
  storage_url: string
  created_at: string
}

export type CommentTrack = 'lp' | 'image' | 'general' | 'note'

export const LP_SECTIONS = [
  'Hero',
  'Offer Details',
  'Product Features',
  'Social Proof / Reviews',
  'Pricing',
  'CTA',
  'Footer',
  'General',
] as const

export interface ProjectComment {
  id: string
  project_id: string
  author_name: string
  content: string
  created_at: string
  track: CommentTrack
  asset_id: string | null
  pin_x: number | null
  pin_y: number | null
  section_tag: string | null
  // 'client' = posted from the public review link; 'internal' = posted from
  // the authed internal review page. Defaulted at the DB level to 'client'.
  audience: 'internal' | 'client'
  // Freeform image attachments (Supabase storage URLs). Distinct from asset_id,
  // which is for pin-annotations on creative-review images.
  attachment_urls: string[] | null
  // Internal-only: set when a teammate marks this feedback handled (Client
  // Feedback panel). NULL = open. Never surfaced on the client review link.
  resolved_at?: string | null
}

export interface CreativeAsset {
  id: string
  project_id: string
  drive_file_id: string
  name: string | null
  thumbnail_url: string | null
  is_hidden: boolean
  sort_order: number
  created_at: string
  revision_url: string | null
  revision_prompt: string | null
  revision_created_at: string | null
  // The revision the client currently sees — set only on "Publish to client".
  // New edits update revision_url (internal) but NOT this, so the client keeps
  // seeing the last published version until you publish again.
  published_url: string | null
  // false = internal-only (not yet on the client review link). Set true on publish.
  client_visible: boolean
  // CLIENT approval — set ONLY via the client review link. Never by internal QC.
  status: 'pending' | 'approved' | 'needs_revision' | 'rejected'
  // INTERNAL QC approval — set ONLY by the internal review tool. Kept separate
  // from `status` so an internal approve never shows as approved to the client.
  internal_status: 'pending' | 'approved' | 'needs_revision' | 'rejected'
}

// A generated marketing-moment report (anonymized public case study). `data` is
// a frozen snapshot shaped like the CaseStudy type in
// src/data/case-studies/types.ts — authored at generation, rendered by the
// public /showcase/<report_token> page. See migration 20260727_add_marketing_reports.
export interface MarketingReport {
  id: string
  project_id: string
  report_token: string
  data: CaseStudy
  created_at: string
  updated_at: string
}

export interface BrandDnaSource {
  url: string
  field: string
  note: string
}

export interface BrandDna {
  id: string
  brand_id: string
  version: number
  is_active: boolean
  logo_url: string | null
  tagline: string | null
  positioning: string | null
  voice_adjectives: string[] | null
  design_agency: string | null
  competitive_differentiation: string | null
  primary_font: string | null
  secondary_font: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
  background_colors: string[] | null
  contrast_color: string | null
  headline_weight: string | null
  body_weight: string | null
  cta_style: string | null
  lighting: string | null
  color_grading: string | null
  composition: string | null
  subject_matter: string | null
  props_and_surfaces: string | null
  mood: string | null
  packaging_description: string | null
  packaging_label_placement: string | null
  packaging_finish: string | null
  packaging_system: string | null
  typical_formats: string | null
  text_overlay_style: string | null
  ugc_usage: string | null
  offer_presentation: string | null
  core_value_prop: string | null
  top_pain_points: string[] | null
  proof_points: string[] | null
  common_offers: string[] | null
  price_anchor: string | null
  top_objections: string[] | null
  winning_hooks: string[] | null
  prompt_modifier: string | null
  sources: BrandDnaSource[] | null
  research_markdown: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Offer Cycle (Prometheus Evolution Phase 2) — the upstream pipeline that
// feeds the Production Cycle. Entirely separate from Stage/projects.
// ---------------------------------------------------------------------------

export type OfferStage =
  | 'auto_generated'
  | 'offer_draft'
  | 'internal_offer_review'
  | 'client_review'
  | 'offer_approved'

export const OFFER_STAGE_LABELS: Record<OfferStage, string> = {
  auto_generated:        'Auto Generated',
  offer_draft:           'Offer Draft',
  internal_offer_review: 'Internal Review',
  client_review:         'Client Review',
  offer_approved:        'Approved',
}

export const OFFER_STAGE_ORDER: OfferStage[] = [
  'auto_generated', 'offer_draft', 'internal_offer_review', 'client_review', 'offer_approved',
]

export interface OfferCard {
  id: string
  brand_id: string
  // First day of the moment's month, 'YYYY-MM-DD'.
  target_month: string
  moment_slot: 1 | 2
  name: string
  stage: OfferStage
  // Owner of this offer card — FK to profiles.id, restricted in the UI to the
  // management roster (strategists). Null = unassigned.
  assigned_to: string | null
  // Strategic fields — same column names as Project, flow to the Production
  // Brief on approval (Phase 3).
  offer_dynamics_type: string | null
  offer: string | null
  offer_description: string | null
  product_featured: string | null
  product_description: string | null
  retail_price: string | null
  page_type: string | null
  // Creative-only fields — stay on the offer, never auto-populate.
  competitor_reference: string | null
  client_ad_inspiration: string | null
  product_images_link: string | null
  // Production card auto-created on approval (Phase 3). Null until then.
  derived_production_card_id: string | null
  created_at: string
  created_by: string | null
  brand?: Brand
}

// 'August 2026' from a target_month DATE string. Forced UTC so the label never
// shifts a day across timezones.
export function offerMonthLabel(targetMonth: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${targetMonth.slice(0, 10)}T00:00:00Z`))
}

// Naming convention from the brief: 'Contour Design · August 2026 · M1 Offer'.
export function offerCardName(brandName: string, targetMonth: string, momentSlot: 1 | 2): string {
  return `${brandName} · ${offerMonthLabel(targetMonth)} · M${momentSlot} Offer`
}

export const STAGE_LABELS: Record<Stage, string> = {
  brief:           'Brief',
  in_progress:     'In Progress',
  internal_review: 'Internal Review',
  client_review:   'Client Review',
  revisions:       'Revisions',
  live:            'Live',
  done:            'Done',
}

export const STAGE_ORDER: Stage[] = ['brief', 'in_progress', 'internal_review', 'client_review', 'revisions', 'live', 'done']
