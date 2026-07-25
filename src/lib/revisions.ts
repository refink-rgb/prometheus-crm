import type { SupabaseClient } from '@supabase/supabase-js'

// One row per AI edit of a creative asset, so the internal review panel can
// label the current image "Edit 3" and link back through Edit 2, Edit 1, and
// the untouched Original.
export interface AssetRevision {
  id: string
  asset_id: string
  revision_number: number
  image_url: string
  prompt: string | null
  created_by: string | null
  created_at: string
}

// Append a revision row for an asset. Numbering is per-asset and 1-based; the
// Drive import is "Original" and is deliberately not a row.
//
// History is a record, not the source of truth — creative_assets.revision_url
// still drives what renders. So a failure here is logged and swallowed rather
// than failing the edit the user just paid an image-model call for.
export async function recordAssetRevision(
  supabase: SupabaseClient,
  params: {
    assetId: string
    imageUrl: string
    prompt: string | null
    createdBy: string | null
  },
): Promise<number | null> {
  try {
    const { data: last } = await supabase
      .from('creative_asset_revisions')
      .select('revision_number')
      .eq('asset_id', params.assetId)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const next = (last?.revision_number ?? 0) + 1

    const { error } = await supabase.from('creative_asset_revisions').insert({
      asset_id: params.assetId,
      revision_number: next,
      image_url: params.imageUrl,
      prompt: params.prompt,
      created_by: params.createdBy,
    })
    if (error) {
      console.error('[recordAssetRevision]', params.assetId, error.message)
      return null
    }
    return next
  } catch (e) {
    console.error('[recordAssetRevision]', params.assetId, e)
    return null
  }
}

// Every recorded edit for a set of assets, oldest first, keyed by asset id.
export async function getRevisionsByAsset(
  supabase: SupabaseClient,
  assetIds: string[],
): Promise<Record<string, AssetRevision[]>> {
  if (assetIds.length === 0) return {}
  const { data, error } = await supabase
    .from('creative_asset_revisions')
    .select('*')
    .in('asset_id', assetIds)
    .order('revision_number', { ascending: true })

  if (error) {
    console.error('[getRevisionsByAsset]', error.message)
    return {}
  }

  const out: Record<string, AssetRevision[]> = {}
  for (const row of (data ?? []) as AssetRevision[]) {
    ;(out[row.asset_id] ??= []).push(row)
  }
  return out
}
