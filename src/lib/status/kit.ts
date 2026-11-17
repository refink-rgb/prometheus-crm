// The "ad kit" for one project: everything needed to upload its ads, in one
// plain shape. The kit page, the JSON feed and the copy-for-an-agent text are
// all built from this, so a person and an AI agent read the same facts.
//
// Pure: no Supabase, no request. The caller supplies the site origin.

import { STAGE_LABELS, normalizeStage } from '../types'
import { BUCKET_LABELS, type ApprovedBy } from './board'
import type { BoardBrand, BoardProject } from './server'

export interface AdKitFile {
  /** 1-based, in the order the team arranged the creatives. */
  position: number
  file_name: string
  media_type: 'image' | 'video'
  /** Direct download, no login. Answers with the file and its real name. */
  download_url: string
}

export interface AdKit {
  client: string
  client_website: string | null
  project: string
  project_id: string
  /** "Ready to launch", "In the works", "Coming up" or "Launched". */
  status: string
  waiting_on: string
  stages: { landing_page: string | null; creatives: string | null }
  due_date: string | null
  /** The page the ads send people to. Null until the team has set one. */
  website_url: string | null
  /**
   * Who signed the files off. "team" means the team approved them and marked
   * the work Ready or Live, but the client's approval is not recorded in the
   * CRM. Null when there are no files.
   */
  approved_by: ApprovedBy | null
  approved_files: AdKitFile[]
  kit_page_url: string
  kit_json_url: string
}

const stageWord = (s: string | null) => (s ? STAGE_LABELS[normalizeStage(s)] : null)

export function buildKit(origin: string, token: string, brand: BoardBrand, project: BoardProject): AdKit {
  return {
    client: brand.name,
    client_website: brand.website,
    project: project.name,
    project_id: project.id,
    status: BUCKET_LABELS[project.bucket],
    waiting_on: project.waiting,
    stages: { landing_page: stageWord(project.lpStage), creatives: stageWord(project.creativesStage) },
    due_date: project.dueDate ? project.dueDate.slice(0, 10) : null,
    website_url: project.lpUrl,
    approved_by: project.approvedBy,
    approved_files: project.approved.map((a, i) => ({
      position: i + 1,
      file_name: a.name?.trim() || `creative-${a.id.slice(0, 8)}`,
      media_type: a.media_type === 'video' ? 'video' : 'image',
      download_url: `${origin}/api/status/${token}/file?asset=${a.id}&dl=1`,
    })),
    kit_page_url: `${origin}/status/${token}/kit/${project.id}`,
    kit_json_url: `${origin}/api/status/${token}/kit?project=${project.id}`,
  }
}

/** "Approved by the client" / "Approved by our team ...", for a label. */
export function approvedByLabel(by: ApprovedBy | null): string {
  if (by === 'client') return 'Approved by the client'
  if (by === 'team') return 'Approved by our team. The client’s approval is not recorded in the CRM.'
  return 'No approved files yet'
}

/** The rules every reader of a kit needs, human or agent. */
export function kitRules(by: ApprovedBy | null): string[] {
  return [
    by === 'team'
      ? 'Every file listed was approved by our team, and the project is marked ready. The client’s approval is not recorded in the CRM: confirm it with the strategist before the ads go live. Use only these files.'
      : 'Every file listed was approved by the client. Use only these files.',
    'Each download link returns the file itself. No login is needed.',
    'Use the website URL as the destination (website URL) of every ad.',
    'If the website URL is missing, stop and ask a person. Do not guess one.',
  ]
}

/**
 * A ready-to-paste brief for an AI agent that will upload the ads. Plain
 * text, every link written out in full: an agent cannot hover or guess.
 */
export function kitInstructions(kit: AdKit): string {
  const files = kit.approved_files
  return [
    `Upload the approved ads for ${kit.client}: ${kit.project}.`,
    '',
    `Website URL for every ad: ${kit.website_url ?? 'NOT SET. Stop and ask a person before uploading.'}`,
    `Approved files: ${files.length}`,
    ...files.map(f => `${f.position}. ${f.file_name} (${f.media_type}): ${f.download_url}`),
    '',
    'Rules:',
    ...kitRules(kit.approved_by).map(r => `- ${r}`),
    '',
    `Full ad kit page: ${kit.kit_page_url}`,
    `Same data as JSON: ${kit.kit_json_url}`,
  ].join('\n')
}
