// src/app/api/xero/connect/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getProfile } from '@/lib/auth'
import { XERO_AUTHORIZE_URL, XERO_SCOPES, xeroEnv, xeroRedirectUri } from '@/lib/xero/config'
import {
  XERO_STATE_COOKIE,
  XERO_STATE_TTL_SECONDS,
  hashOAuthState,
  newOAuthState,
} from '@/lib/xero/oauth-state'

export const runtime = 'nodejs'

/**
 * Settings → Xero → "Connect to Xero". Admin only. Sets an httpOnly cookie
 * holding sha256(state) and 302s to Xero's consent screen with EXACTLY the
 * five approved scopes (spec §3). The user logs in on Xero's side — no Xero
 * credentials ever touch ECR.
 */
export async function GET(request: Request) {
  const profile = await getProfile()
  if (!profile || profile.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }
  const env = xeroEnv()
  if (!env) {
    return NextResponse.redirect(new URL('/settings?tab=xero&xero=unconfigured', request.url))
  }

  const state = newOAuthState()
  const cookieStore = await cookies()
  cookieStore.set(XERO_STATE_COOKIE, hashOAuthState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/xero',
    maxAge: XERO_STATE_TTL_SECONDS,
  })

  const url = new URL(XERO_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', env.clientId)
  url.searchParams.set('redirect_uri', xeroRedirectUri())
  url.searchParams.set('scope', XERO_SCOPES)
  url.searchParams.set('state', state)
  return NextResponse.redirect(url)
}
