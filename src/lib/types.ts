export type Stage = 'brief' | 'in_progress' | 'review' | 'done'

export interface Brand {
  id: string
  name: string
  website: string
  created_at: string
  created_by: string
}

export interface Project {
  id: string
  brand_id: string
  name: string
  due_date: string
  font: string | null
  author: string | null
  offer: string | null
  discount: string | null
  headline: string | null
  body_copy: string | null
  cta: string | null
  target_audience: string | null
  notes: string | null
  assigned_designer: string | null
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

export const STAGE_LABELS: Record<Stage, string> = {
  brief: 'Brief',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

export const STAGE_ORDER: Stage[] = ['brief', 'in_progress', 'review', 'done']
