import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Supabase session refresh (the @supabase/ssr `updateSession` pattern),
 * using the Next.js 16 `proxy` convention (renamed from `middleware`).
 *
 * Refreshes auth token cookies on every matched request and redirects
 * unauthenticated users to /login.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: do not run code between createServerClient and
  // supabase.auth.getUser() — it can cause random logouts.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  // A dead session (e.g. a stale refresh token from a previous login) would
  // otherwise re-attempt refresh on every request, spamming auth errors in
  // both server and browser consoles. Clear the auth cookies once so the
  // browser stops presenting it. (No session at all → no cookies → no-op.)
  const staleAuthCookies =
    !user && authError
      ? request.cookies
          .getAll()
          .filter((c) => /^sb-.+-auth-token/.test(c.name))
      : []
  const clearStale = <T extends NextResponse>(res: T): T => {
    staleAuthCookies.forEach((c) => res.cookies.delete(c.name))
    return res
  }

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return clearStale(NextResponse.redirect(url))
  }

  // Redirect authenticated users away from /login
  if (user && request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // IMPORTANT: return the supabaseResponse object as-is so refreshed
  // auth cookies stay in sync between browser and server.
  return clearStale(supabaseResponse)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes
     * - /sign/* and /submit/* — public external pages (token-gated, no
     *   login). Excluding them here also skips the proxy for their Server
     *   Function POSTs, which submit via the anon-granted RPCs.
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico and common static assets
     */
    '/((?!api|sign/|submit/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|map)$).*)',
  ],
}
