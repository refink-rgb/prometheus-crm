import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { createClient } from '@/lib/supabase/server'
import { canEdit } from '@/lib/permissions'

// Zipping fetched images is Node-only (Buffer / jszip) and can take a while for
// a large set of approved creatives.
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/projects/[projectId]/download-approved
 * Streams a .zip of every creative the CLIENT has approved (status='approved')
 * on the review link. Image bytes come from the published revision when one
 * exists, otherwise the original Drive file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  if (!canEdit(user.email)) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const [{ data: project }, { data: assets }] = await Promise.all([
    supabase.from('projects').select('name').eq('id', projectId).single(),
    supabase
      .from('creative_assets')
      .select('id, name, drive_file_id, published_url, sort_order')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .eq('is_hidden', false)
      .order('sort_order'),
  ])

  if (!assets || assets.length === 0) {
    return NextResponse.json({ error: 'No client-approved images to download yet.' }, { status: 404 })
  }

  // Fetch the client-facing image bytes for one asset (published revision first,
  // else the original Drive file). Returns null on any failure (skipped).
  async function fetchBytes(a: { published_url: string | null; drive_file_id: string }): Promise<{ buf: ArrayBuffer; ext: string } | null> {
    const url = a.published_url || `https://drive.google.com/uc?export=download&id=${a.drive_file_id}`
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) return null
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('text/html')) return null // Drive permission page, not an image
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
      return { buf: await res.arrayBuffer(), ext }
    } catch {
      return null
    }
  }

  const zip = new JSZip()
  const used = new Set<string>()
  let added = 0

  // Bounded concurrency so we don't open 50 sockets at once.
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
        const base = (a.name || `creative_${i + 1}`).replace(/[^\w.-]+/g, '_').replace(/\.(png|jpe?g|webp)$/i, '')
        let name = `${String(i + 1).padStart(2, '0')}_${base}.${got.ext}`
        let n = 2
        while (used.has(name)) { name = `${String(i + 1).padStart(2, '0')}_${base}_${n++}.${got.ext}` }
        used.add(name)
        zip.file(name, got.buf)
        added++
      }
    }),
  )

  if (added === 0) {
    return NextResponse.json(
      { error: 'Approved images could not be fetched. Ensure the Drive folder is shared "Anyone with the link".' },
      { status: 502 },
    )
  }

  const body = await zip.generateAsync({ type: 'arraybuffer' })
  const safeProject = (project?.name || 'project').replace(/[^\w.-]+/g, '_')
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeProject}-approved-${added}.zip"`,
    },
  })
}
