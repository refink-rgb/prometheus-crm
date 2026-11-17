import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadBoard, loadBoardProject, resolveStatusToken } from '@/lib/status/server'
import { buildKit, kitRules } from '@/lib/status/kit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/status/[token]/kit              every project with approved files
 * GET /api/status/[token]/kit?project=<id> one project
 *
 * The status board as data, for AI agents and scripts that upload ads: each
 * project's website URL and a direct download link per client-approved file.
 * Same token and same rules as the pages: nothing here that the board does
 * not already show.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const url = new URL(request.url)
  const service = createServiceClient()
  const engineer = await resolveStatusToken(service, token)
  if (!engineer) return json({ error: 'Invalid link.' }, 404)

  const projectId = url.searchParams.get('project')
  if (projectId) {
    const found = await loadBoardProject(service, engineer, projectId)
    if (!found) return json({ error: 'Unknown project.' }, 404)
    const kit = buildKit(url.origin, token, found.brand, found.project)
    return json({ how_to_use: kitRules(kit.approved_by), ...kit })
  }

  const brands = (await loadBoard(service, engineer)) ?? []
  return json({
    strategist: engineer,
    generated_at: new Date().toISOString(),
    // Each project says who approved its files (approved_by). Where that is
    // "team", the client's approval is not recorded: confirm before going live.
    how_to_use: kitRules('client'),
    clients: brands.map(brand => ({
      client: brand.name,
      client_website: brand.website,
      // Only projects that have something to upload.
      projects: brand.projects
        .filter(p => p.approved.length > 0)
        .map(p => {
          const kit = buildKit(url.origin, token, brand, p)
          return { ...kit, how_to_use: kitRules(kit.approved_by) }
        }),
    })),
  })
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  })
}
