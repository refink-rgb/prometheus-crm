import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Companion to /api/preview. The previewed page runs in an opaque origin, so
// every same-origin XHR it makes (`/cart.js`, `?sections=`, `/products/x.js`)
// is cross-origin and dies on CORS — which silently empties any section the
// theme renders client-side. The injected shim rewrites those calls here, and
// we replay them against the project's own `lp_url` origin.
//
// SSRF-safe by the same rule as the parent route: the caller supplies a share
// token plus a *path*, never a host. The origin is resolved server-side from
// `lp_url`, so a caller can never point this at an arbitrary target.

const FORWARD_TIMEOUT_MS = 10_000

const CORS: Record<string, string> = {
  // The requesting document is sandboxed, so its Origin is `null` and the
  // request is necessarily credential-less — `*` grants nothing extra.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, x-requested-with',
  'cache-control': 'no-store',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: Request) {
  return forward(req)
}
export async function POST(req: Request) {
  return forward(req)
}
export async function PUT(req: Request) {
  return forward(req)
}
export async function PATCH(req: Request) {
  return forward(req)
}
export async function DELETE(req: Request) {
  return forward(req)
}

async function forward(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  const path = searchParams.get('path')

  if (!token || !path) return corsJson({ error: 'bad_request' }, 400)

  // Must be a site-relative path. `//host` is protocol-relative and would
  // escape the project's origin, so it is rejected alongside absolute URLs.
  if (!path.startsWith('/') || path.startsWith('//')) {
    return corsJson({ error: 'bad_path' }, 400)
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('lp_url')
    .eq('share_token', token)
    .single<{ lp_url: string | null }>()

  const lpUrl = project?.lp_url
  if (!lpUrl || !/^https?:\/\//i.test(lpUrl)) return corsJson({ error: 'no_url' }, 404)

  let target: URL
  try {
    target = new URL(path, new URL(lpUrl).origin)
  } catch {
    return corsJson({ error: 'bad_path' }, 400)
  }

  const method = req.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer()

  try {
    const upstream = await fetch(target, {
      method,
      body,
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      headers: {
        // Deliberately no cookies or auth headers: the preview is anonymous.
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        accept: req.headers.get('accept') ?? '*/*',
        'accept-language': 'en-US,en;q=0.9',
        ...(req.headers.get('content-type')
          ? { 'content-type': req.headers.get('content-type')! }
          : {}),
        'x-requested-with': 'XMLHttpRequest',
      },
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      },
    })
  } catch {
    return corsJson({ error: 'upstream_failed' }, 502)
  }
}

function corsJson(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}
