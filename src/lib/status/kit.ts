// The "ad kit" for one project: everything needed to upload its ads, in one
// plain shape. The kit page, the JSON feed and the prompt for an AI agent are
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

/** Where the Ads Uploader connector lives, and its set-up guide. */
export const ADS_UPLOADER_MCP_URL = 'https://adsuploader.com/api/mcp'
export const ADS_UPLOADER_DOCS_URL = 'https://adsuploader.com/docs/automation/mcp'
/** Ads Uploader takes at most this many links in one upload call. */
const UPLOAD_CALL_MAX = 50

/**
 * The prompt a strategist pastes into their AI agent to get a project's ads
 * into Meta through Ads Uploader. It carries everything the agent needs, so
 * it never has to open the board: how to connect Ads Uploader if it is not
 * connected yet, the website URL, and a direct link for every file.
 *
 * Ads Uploader fetches each link itself and takes the file's name from the
 * answer, so the agent passes links and never handles a file.
 *
 * The agent uploads the files, then stops: the board does not carry the ad
 * text or the campaign, and nothing may go live on the agent's own word.
 */
export function agentPrompt(kit: AdKit): string {
  const files = kit.approved_files
  const n = files.length
  const byTeam = kit.approved_by === 'team'
  return [
    `Help me upload the approved ads for ${kit.client} (${kit.project}) to Meta with Ads Uploader.`,
    '',
    `Client: ${kit.client}`,
    `Project: ${kit.project}`,
    `Website URL for every ad: ${kit.website_url ?? 'NOT SET. Ask me for it before you create any ad.'}`,
    `Approved files: ${n} (${byTeam ? 'approved by our team' : 'approved by the client'})`,
    `All files on one page: ${kit.kit_page_url}`,
    '',
    'Step 1. Check that Ads Uploader is connected.',
    `Call the Ads Uploader tool ads_whoami and tell me which user you are signed in as. If you have no Ads Uploader tools, stop and tell me to connect it first: in this app's connector settings, add a custom connector (MCP server) with the URL ${ADS_UPLOADER_MCP_URL}, sign in to Ads Uploader in the browser window that opens, then send you this prompt again. Set-up guide: ${ADS_UPLOADER_DOCS_URL}`,
    '',
    'Step 2. Find the ad account.',
    `Call ads_list_accounts and pick the account for ${kit.client}. If no account clearly matches, or more than one does, ask me which to use.`,
    '',
    'Step 3. Upload the files.',
    'Call ads_upload with that accountId and the file links below, each one as files[].url. Do not download the files yourself: Ads Uploader fetches each link directly. No login is needed, and each link answers with the file under its real name.'
      + (n > UPLOAD_CALL_MAX ? ` Send at most ${UPLOAD_CALL_MAX} links per call, and pass the batchId from the first call to the later calls so all ${n} files land in one batch.` : ''),
    'Then call ads_get_upload with the jobId until complete is true. Tell me how many files uploaded and name any that failed.',
    '',
    'Step 4. Stop and ask me before you create any ad.',
    'Ask me which campaign and ad set to use (or which existing ad to copy the settings from), and for the ad text: this prompt does not carry ad text. Use the website URL above as the link of every ad. Call ads_preview and show me the plan before you create anything. Create the ads paused (options.status PAUSED). Never set anything live unless I say so.',
    '',
    'Rules:',
    '- Use only the files listed here.',
    byTeam
      ? '- These files were approved by our team and the project is marked ready, but the client’s approval is not recorded in the CRM. Remind me to confirm it before any ad goes live.'
      : '- Every file listed was approved by the client.',
    '- If the website URL is missing, ask me for it. Do not guess one.',
    '',
    `Files (${n}):`,
    ...files.map(f => `${f.position}. ${f.file_name} (${f.media_type}): ${f.download_url}`),
  ].join('\n')
}
