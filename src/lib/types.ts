export type Stage = 'brief' | 'in_progress' | 'review' | 'done'

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
  created_at: string
  created_by: string
}

export interface Project {
  id: string
  brand_id: string
  name: string
  due_date: string
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
  // client review
  share_token: string | null
  client_approved: boolean
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
}

export interface ProjectImage {
  id: string
  project_id: string
  storage_path: string
  storage_url: string
  created_at: string
}

export interface ProjectComment {
  id: string
  project_id: string
  author_name: string
  content: string
  created_at: string
}

export const STAGE_LABELS: Record<Stage, string> = {
  brief: 'Brief',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

export const STAGE_ORDER: Stage[] = ['brief', 'in_progress', 'review', 'done']
