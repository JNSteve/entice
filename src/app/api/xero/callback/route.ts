// src/app/api/xero/callback/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { XERO_STATE_COOKIE, oauthStateMatches } from '@/lib/xero/oauth-state'
import {
  exchangeCodeForTokens,
  listConnections,
  loadConnection,
  storeTokenSet,
} from '@/lib/xero/tokens'

export const runtime = 'nodejs'

/**
 * Xero redirects here after consent. Verifies state (timing-safe against the
 * hashed cookie), exchanges the code, resolves the tenant, stores encrypted
 * tokens, and ALWAYS answers with a 302 to Settings — `code`/`state` never
 * appear in a response body (Xero security standard: sensitive URL params →
 * redirect). Outcomes are passed as ?xero=… flags the Xero tab renders.
 */
function back(request: Request, flag: string) {
  return NextResponse.redirect(new URL(`/settings?tab=xero&xero=${flag}`, request.url))
}

export async function GET(request: Request) {
  const profile = await getProfile()
  if (!profile || profile.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(request.url)
  const cookieStore = await cookies()
  const cookieHash = cookieStore.get(XERO_STATE_COOKIE)?.value
  cookieStore.delete(XERO_STATE_COOKIE)

  if (url.searchParams.get('error')) return back(request, 'denied')
  const code = url.searchParams.get('code')
  if (!code || !oauthStateMatches(url.searchParams.get('state'), cookieHash)) {
    return back(request, 'state')
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return back(request, 'noservicerole')
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const tenants = (await listConnections(tokens.access_token)).filter(
      (t) => t.tenantType === undefined || t.tenantType === 'ORGANISATION'
    )
    if (tenants.length === 0) return back(request, 'notenant')
    if (tenants.length > 1) return back(request, 'multitenant')
    const tenant = tenants[0]

    const existing = await loadConnection(admin)
    const switching =
      Boolean(existing?.tenant_id) && existing!.tenant_id !== tenant.tenantId

    await storeTokenSet(admin, tokens, {
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName ?? tenant.tenantId,
      connection_id: tenant.id,
      connected_by: profile.id,
      connected_at: new Date().toISOString(),
      // A different org than before needs the typed confirmation in Settings
      // (spec §5.1) before anything syncs.
      status: switching ? 'needs_reconnect' : 'connected',
    })
    return back(request, switching ? 'switched' : 'connected')
  } catch (err) {
    console.error('[xero] callback failed:', err instanceof Error ? err.message : err)
    return back(request, 'failed')
  }
}
