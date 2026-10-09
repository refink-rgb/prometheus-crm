import JSZip from 'jszip'

export type ZipAsset = {
  name?: string | null
  drive_file_id: string
  published_url?: string | null
  media_type?: string | null
  video_url?: string | null
}

// Fetch the client-facing bytes for one asset: published revision first, else
// the original. A video's original is our storage copy — Drive's download link
// turns into a "can't scan for viruses" page for large files. Returns null on
// any failure (asset is skipped).
async function fetchBytes(a: ZipAsset): Promise<{ buf: ArrayBuffer; ext: string } | null> {
  const url = a.published_url
    || (a.media_type === 'video' ? a.video_url : null)
    || `https://drive.google.com/uc?export=download&id=${a.drive_file_id}`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('text/html')) return null // Drive permission page, not an image
    const ext = ct.includes('mp4') ? 'mp4' : ct.includes('quicktime') ? 'mov' : ct.includes('webm') ? 'webm'
      : ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    return { buf: await res.arrayBuffer(), ext }
  } catch {
    return null
  }
}

/**
 * Build a .zip (as ArrayBuffer) of the given assets' client-facing images,
 * fetched with bounded concurrency. Returns the zip bytes and how many made it
 * in (assets whose image couldn't be fetched are skipped).
 */
export async function zipAssets(assets: ZipAsset[]): Promise<{ body: ArrayBuffer; added: number }> {
  const zip = new JSZip()
  const used = new Set<string>()
  let added = 0

  const queue = assets.map((a, i) => ({ a, i }))
  const CONC = 5
  await Promise.all(
    Array.from({ length: Math.min(CONC, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()
        if (!item) break
        const { a, i } = item
        const got = await fetchBytes(a)
        if (!got) continue
        const base = (a.name || `creative_${i + 1}`).replace(/[^\w.-]+/g, '_').replace(/\.(png|jpe?g|webp|mp4|mov|webm|m4v)$/i, '')
        let name = `${String(i + 1).padStart(2, '0')}_${base}.${got.ext}`
        let n = 2
        while (used.has(name)) { name = `${String(i + 1).padStart(2, '0')}_${base}_${n++}.${got.ext}` }
        used.add(name)
        zip.file(name, got.buf)
        added++
      }
    }),
  )

  const body = await zip.generateAsync({ type: 'arraybuffer' })
  return { body, added }
}
