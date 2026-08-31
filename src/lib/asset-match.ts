// Matching re-exported creative files back to the assets they revise.
//
// An editor fixes a batch in Photoshop and exports them with the SAME names
// they came in with. Bulk upload has to map each file onto the right existing
// asset, and the only signal is the filename.
//
// THE TRAP: `_v43` / `_v21` in this shop are VARIANT numbers — v21 and v43 are
// two different ads, not two versions of one ad. An earlier normaliser stripped
// `_vN` as if it were a revision marker and collapsed 14 distinct creatives
// into single rows. Tested against all 633 live filenames: stripping only the
// suffixes an OS or an export adds — `copy`, `(1)`, case, extension — produces
// zero collisions, and every creative still resolves to itself.
//
// So: strip only what a machine added. Never strip what a person typed.

/**
 * Reduce a filename to a stable key. Removes the file extension, lowercases,
 * and repeatedly strips trailing OS/export artefacts (`copy`, `copy 2`,
 * `- Copy`, `(1)`) so `ad_v43 copy 2.PNG` and `ad_v43.png` share a key —
 * while `ad_v43` and `ad_v21` deliberately do not.
 */
export function normaliseAssetName(filename: string): string {
  let s = filename.trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '')
  let prev: string
  do {
    prev = s
    s = s.replace(/[\s._-]*\(\d+\)$/, '')             // (1) (2)
    s = s.replace(/[\s._-]*-?\s*copy(\s*\d+)?$/, '')  // copy / copy 2 / - Copy
    s = s.replace(/[\s._-]+$/, '')
  } while (s !== prev)
  return s
}

export interface MatchableAsset {
  id: string
  name: string | null
}

export interface RevisionMatch<F> {
  /** Exactly one asset claims this file. Safe to upload unattended. */
  matched: Array<{ file: F; asset: MatchableAsset }>
  /** Several assets share the file's key — a human has to choose. */
  ambiguous: Array<{ file: F; candidates: MatchableAsset[] }>
  /** No asset claims it. Probably a new creative, not a revision. */
  unmatched: F[]
}

/**
 * Map dropped files onto the assets they revise, by normalised filename.
 *
 * Deliberately conservative: anything that is not a clean 1:1 hit lands in
 * `ambiguous` or `unmatched` for a person to resolve. Uploading a revision onto
 * the wrong asset silently replaces a creative the client may already have
 * approved, so a wrong guess costs far more than an unmatched file does.
 */
export function matchRevisionsToAssets<F extends { name: string }>(
  files: F[],
  assets: MatchableAsset[],
): RevisionMatch<F> {
  const byKey = new Map<string, MatchableAsset[]>()
  for (const a of assets) {
    if (!a.name) continue
    const k = normaliseAssetName(a.name)
    const bucket = byKey.get(k)
    if (bucket) bucket.push(a)
    else byKey.set(k, [a])
  }

  const out: RevisionMatch<F> = { matched: [], ambiguous: [], unmatched: [] }
  for (const file of files) {
    const candidates = byKey.get(normaliseAssetName(file.name))
    if (!candidates || candidates.length === 0) out.unmatched.push(file)
    else if (candidates.length === 1) out.matched.push({ file, asset: candidates[0] })
    else out.ambiguous.push({ file, candidates })
  }
  return out
}
