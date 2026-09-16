import type { SupabaseClient } from '@supabase/supabase-js'
import { BRIEF_BUCKET } from '@/lib/project-briefs'

/**
 * Deletes everything under <project>/<brief>/.
 *
 * Callers delete the ROW first, then the folder. Anything that writes into the
 * folder later (the AI read storing pictures, a tab uploading page previews)
 * finds its row gone and calls this again, so files written between the two
 * steps are still caught.
 */
export async function removeBriefFolder(
  supabase: Pick<SupabaseClient, 'storage'>, projectId: string, briefId: string,
): Promise<void> {
  const bucket = supabase.storage.from(BRIEF_BUCKET)
  const folder = `${projectId}/${briefId}`
  const { data: objects, error } = await bucket.list(folder, { limit: 1000 })
  if (error) { console.error('[brief files] list failed', folder, error.message); return }
  const paths = (objects ?? []).map(o => `${folder}/${o.name}`)
  if (!paths.length) return
  const { error: rmErr } = await bucket.remove(paths)
  if (rmErr) console.error('[brief files] orphaned objects', folder, rmErr.message)
}
