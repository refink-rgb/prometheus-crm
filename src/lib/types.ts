export type Stage = 'brief' | 'in_progress' | 'review' | 'done'

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
  'Long Form',
  'Short Form',
  'Advertorial',
  'Listicle',
  'Video Sales Letter',
  'Other',
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
  due_date: string
  drive_folder_url: string | null
  // offer description step
  offer_description: string | null
  inspiration: string | null
  // copy & offer step
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
  needs_revisions: boolean
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

export type CommentTrack = 'lp' | 'image' | 'general'

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
  status: 'pending' | 'approved' | 'needs_revision'
}

export const STAGE_LABELS: Record<Stage, string> = {
  brief: 'Brief',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

export const STAGE_ORDER: Stage[] = ['brief', 'in_progress', 'review', 'done']
