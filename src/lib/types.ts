export type Stage = 'brief' | 'in_progress' | 'internal_review' | 'client_review' | 'live' | 'done'

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
  assigned_designer: string | null
  // journey & moment
  journey_id: string | null
  marketing_moment: 1 | 2 | null
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

export const STAGE_LABELS: Record<Stage, string> = {
  brief:           'Brief',
  in_progress:     'In Progress',
  internal_review: 'Internal Review',
  client_review:   'Client Review',
  live:            'Live',
  done:            'Done',
}

export const STAGE_ORDER: Stage[] = ['brief', 'in_progress', 'internal_review', 'client_review', 'live', 'done']
