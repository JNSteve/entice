import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  isAcceptableRedirectUri,
  oauthError,
  randomToken,
} from '@/lib/agent-oauth'

export const runtime = 'nodejs'

/**
 * RFC 7591 dynamic client registration — how claude.ai registers itself before
 * the authorization flow. Open by design (that is what DCR is), but registering
 * a client grants NOTHING on its own: every grant still needs an admin to
 * approve it on the consent screen, so a stray registration is inert.
 */
export async function POST(request: Request) {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(oauthError('server_error', 'service role key missing'), {
      status: 503,
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(oauthError('invalid_request', 'body must be JSON'), {
      status: 400,
    })
  }

  const b = (body ?? {}) as Record<string, unknown>
  const redirectUris = Array.isArray(b.redirect_uris) ? b.redirect_uris : []
  if (redirectUris.length === 0) {
    return NextResponse.json(
      oauthError('invalid_request', 'redirect_uris is required'),
      { status: 400 }
    )
  }
  if (redirectUris.length > 10) {
    return NextResponse.json(
      oauthError('invalid_request', 'too many redirect_uris'),
      { status: 400 }
    )
  }
  const uris = redirectUris.map((u) => String(u))
  const bad = uris.find((u) => !isAcceptableRedirectUri(u))
  if (bad) {
    return NextResponse.json(
      oauthError('invalid_request', `unacceptable redirect_uri: ${bad}`),
      { status: 400 }
    )
  }

  const clientId = randomToken(16)
  const clientName =
    typeof b.client_name === 'string' ? b.client_name.slice(0, 200) : null

  const { error } = await admin.from('agent_oauth_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: uris,
  })
  if (error) {
    return NextResponse.json(oauthError('server_error', error.message), { status: 500 })
  }

  // Public client (PKCE, no secret) — matches token_endpoint_auth_methods_supported.
  return NextResponse.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201 }
  )
}
