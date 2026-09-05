import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Token-authed routes bypass the session check: /api/preview and /api/review
// use the project's share_token; /api/creative uses a Bearer editor token
// validated at the route level; /api/cron checks CRON_SECRET in-route;
// /api/results checks RESULTS_INGEST_SECRET in-route (the scheduled Meta-MCP
// agent posts daily campaign results and has no session cookie).
const PUBLIC_PREFIXES = ['/login', '/review', '/portal', '/showcase', '/offer-preview-qa', '/auth', '/api/preview', '/api/review', '/api/creative', '/api/cron', '/api/results']

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim()
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

function b64Decode(s: string): string {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  return atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
}

// Read the (possibly chunked) @supabase/ssr auth cookie and pull out the
// access token — no network call.
function readAccessToken(request: NextRequest): string | null {
  let raw = request.cookies.get(COOKIE_NAME)?.value ?? ''
  if (!raw) {
    // @supabase/ssr splits large sessions into `.0`, `.1`, … chunk cookies
    for (let i = 0; ; i++) {
      const chunk = request.cookies.get(`${COOKIE_NAME}.${i}`)?.value
      if (!chunk) break
      raw += chunk
    }
  }
  if (!raw) return null
  try {
    const json = raw.startsWith('base64-') ? b64Decode(raw.slice(7)) : decodeURIComponent(raw)
    const session = JSON.parse(json)
    return typeof session?.access_token === 'string' ? session.access_token : null
  } catch {
    return null
  }
}

// Decode (NOT verify) the JWT payload just to read its expiry. Middleware only
// decides redirect-vs-continue; every page still validates the token for real
// via supabase.auth.getUser() and RLS, so a forged cookie gets no data.
function tokenIsFresh(token: string): boolean {
  try {
    const payload = JSON.parse(b64Decode(token.split('.')[1]))
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + 30_000
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const isPublic = PUBLIC_PREFIXES.some(p => request.nextUrl.pathname.startsWith(p))
  const token = readAccessToken(request)

  // Fast path (the ~hourly common case): unexpired session cookie → continue
  // with zero network round-trips. Previously this called auth.getUser() —
  // a ~300ms trip from the edge to Supabase Auth on EVERY navigation.
  if (token && tokenIsFresh(token)) {
    return NextResponse.next({ request })
  }
  if (!token && isPublic) {
    return NextResponse.next({ request })
  }
  if (!token) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Slow path (token expired, roughly once per hour per user): do the real
  // network check, which also rotates the cookies via the refresh token.
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)'],
}
