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
  // browser stops presenting it.
  //
  // Only clear on a DEFINITIVE session failure (a 4xx auth error such as
  // refresh_token_not_found). A transient network/TLS hiccup surfaces as
  // AuthRetryableFetchError (status 0) — we must NOT wipe a valid session in
  // that case, or the user gets logged out mid-work on any blip.
  const err = authError as { name?: string; status?: number } | null
  const isDefiniteSessionFailure =
    !!err &&
    err.name !== 'AuthRetryableFetchError' &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  const staleAuthCookies =
    !user && isDefiniteSessionFailure
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
     * - /sign/*, /submit/*, /portal/*, /haul/* and /receive/* — public
     *   external pages (token-gated, no login). /haul and /receive are the
     *   transporter and receiver halves of a regulated waste movement.
     *   Excluding them here also skips the proxy for their Server Function
     *   POSTs / file routes, which use the anon-granted RPCs.
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico and common static assets
     */
    // NOTE: .webmanifest MUST stay in the extension list. The manifest is
    // fetched by the browser BEFORE anyone signs in (and by the install
    // prompt), so proxying it returns a 307 to /login and the PWA silently
    // falls back to defaults — wrong name, no standalone display, no icons.
    '/((?!api|sign/|submit/|portal/|haul/|receive/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|map|webmanifest)$).*)',
  ],
}
