import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDriveFile } from '@/lib/drive'
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from '@/lib/creative-media'
import { recordAssetRevision } from '@/lib/revisions'

// Copy Drive videos into our storage so they play for everyone.
//
// A client on the review link has no Google sign-in, and Drive's own player
// needs one. So the sync only QUEUES a video (video_status 'pending', with the
// Drive file + version in video_source_id) and this does the copy afterwards,
// outside the sync's request: a 40MB video takes a while, and a folder can hold
// several.
//
// One video at a time, claimed atomically, so two runs (a second editor
// opening the page, a double click) never copy the same file twice.

/** An 'importing' row older than this died with its function; it is claimable again. */
const STALE_IMPORT_MS = 6 * 60_000

type Row = {
  id: string
  project_id: string
  drive_file_id: string
  video_source_id: string | null
  video_status: string | null
  video_started_at: string | null
  status: string | null
}

export interface ImportSummary { copied: number; revisions: number; failed: number; tooLarge: number; left: number }

/** Where the bytes come from. Drive in production; a test passes its own. */
export type VideoFetcher = typeof downloadDriveFile

export async function importPendingVideos(
  supabase: SupabaseClient,
  projectId: string,
  deadline: number,
  fetchVideo: VideoFetcher = downloadDriveFile,
): Promise<ImportSummary> {
  const summary: ImportSummary = { copied: 0, revisions: 0, failed: 0, tooLarge: 0, left: 0 }

  // Leave a minute: a copy that starts too late cannot finish inside the function.
  while (Date.now() < deadline - 60_000) {
    const row = await claimNext(supabase, projectId)
    if (!row) break
    const outcome = await importOne(supabase, row, fetchVideo)
    summary[outcome]++
  }

  const { count } = await supabase.from('creative_assets').select('id', { count: 'exact', head: true })
    .eq('project_id', projectId).eq('media_type', 'video').in('video_status', ['pending', 'importing'])
  summary.left = count ?? 0
  return summary
}

async function claimNext(supabase: SupabaseClient, projectId: string): Promise<Row | null> {
  const staleBefore = new Date(Date.now() - STALE_IMPORT_MS).toISOString()
  const { data: candidates } = await supabase.from('creative_assets')
    .select('id, project_id, drive_file_id, video_source_id, video_status, video_started_at, status')
    .eq('project_id', projectId).eq('media_type', 'video')
    .or(`video_status.eq.pending,and(video_status.eq.importing,video_started_at.lt."${staleBefore}")`)
    .order('sort_order').limit(5)

  for (const c of (candidates ?? []) as Row[]) {
    // Only flips if nobody else claimed it between the read and this write.
    let q = supabase.from('creative_assets')
      .update({ video_status: 'importing', video_started_at: new Date().toISOString(), video_error: null })
      .eq('id', c.id).eq('video_status', c.video_status ?? 'pending')
    if (c.video_status === 'importing' && c.video_started_at) q = q.eq('video_started_at', c.video_started_at)
    const { data } = await q.select('id')
    if (data?.length) return c
  }
  return null
}

async function importOne(supabase: SupabaseClient, row: Row, fetchVideo: VideoFetcher): Promise<'copied' | 'revisions' | 'failed' | 'tooLarge'> {
  const [fileId, stamp = '0'] = (row.video_source_id ?? row.drive_file_id).split('@')
  const fail = async (status: 'failed' | 'too_large', message: string) => {
    await supabase.from('creative_assets').update({ video_status: status, video_error: message.slice(0, 300) }).eq('id', row.id)
    return status === 'too_large' ? 'tooLarge' as const : 'failed' as const
  }

  try {
    const got = await fetchVideo(fileId, MAX_VIDEO_BYTES)
    if (!got.ok) return fail(got.reason === 'too_large' ? 'too_large' : 'failed', got.message)

    const ext = VIDEO_TYPES[got.mimeType] ?? 'mp4'
    const contentType = VIDEO_TYPES[got.mimeType] ? got.mimeType : 'video/mp4'
    // The Drive file id and version are IN the path: the sync compares against
    // it to know this exact file is already copied, so a re-sync never copies
    // it twice.
    const path = `videos/${row.id}/${fileId}-${stamp}.${ext}`
    const up = await supabase.storage.from('project-images')
      .upload(path, got.bytes, { contentType, upsert: true, cacheControl: '31536000' })
    if (up.error) {
      return /exceeded|maximum allowed size/i.test(up.error.message)
        ? fail('too_large', `over the ${MAX_VIDEO_BYTES / 1048576}MB storage limit`)
        : fail('failed', `storage: ${up.error.message}`)
    }
    const { data: { publicUrl } } = supabase.storage.from('project-images').getPublicUrl(path)

    if (fileId === row.drive_file_id) {
      await supabase.from('creative_assets')
        .update({ video_url: publicUrl, video_status: 'ready', video_source_id: null, video_error: null })
        .eq('id', row.id)
      return 'copied'
    }

    // A re-uploaded fix: the same rules as an image revision. published_url
    // follows it; a client approval of the OLD cut is reset, because they never
    // saw this one.
    const patch: Record<string, unknown> = {
      revision_url: publicUrl, published_url: publicUrl, revision_created_at: new Date().toISOString(),
      video_status: 'ready', video_source_id: null, video_error: null,
    }
    if (row.status === 'approved') patch.status = 'pending'
    await supabase.from('creative_assets').update(patch).eq('id', row.id)
    await recordAssetRevision(supabase, { assetId: row.id, imageUrl: publicUrl, prompt: null, createdBy: 'Drive sync' })
    return 'revisions'
  } catch (e) {
    return fail('failed', e instanceof Error ? e.message : 'unknown error')
  }
}
