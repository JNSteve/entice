import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { oauthError, sha256Hex, verifyPkceS256 } from '@/lib/agent-oauth'
import { findClient, issueTokens } from '@/lib/agent-oauth-server'

export const runtime = 'nodejs'

/**
 * OAuth token endpoint — authorization_code exchange and refresh_token rotation.
 *
 * Public client, so the caller proves itself with PKCE rather than a secret.
 * Codes are single-use (used_at guard), hashed at rest, and bound to the
 * client + redirect_uri they were issued for.
 */

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })

async function readForm(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      const b = (await request.json()) as Record<string, unknown>
      for (const [k, v] of Object.entries(b ?? {})) if (typeof v === 'string') out[k] = v
    } catch {
      /* fall through to empty */
    }
    return out
  }
  const form = await request.formData()
  for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v
  return out
}

export async function POST(request: Request) {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return json(oauthError('server_error', 'service role key missing'), 503)
  }

  const p = await readForm(request)
  const grantType = p.grant_type ?? ''

  // ── authorization_code ────────────────────────────────────────────────
  if (grantType === 'authorization_code') {
    const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier } = p
    if (!code || !redirectUri || !clientId || !verifier) {
      return json(
        oauthError('invalid_request', 'code, redirect_uri, client_id and code_verifier are required'),
        400
      )
    }

    const client = await findClient(admin, clientId)
    if (!client) return json(oauthError('invalid_client', 'unknown client'), 401)

    const { data: row, error } = await admin
      .from('agent_oauth_codes')
      .select('code_hash, client_id, redirect_uri, code_challenge, scope, resource, approved_by, expires_at, used_at')
      .eq('code_hash', sha256Hex(code))
      .maybeSingle()
    if (error) return json(oauthError('server_error', error.message), 500)
    if (!row) return json(oauthError('invalid_grant', 'unknown or expired code'), 400)

    // Single-use: burn it before anything else can race us.
    const { data: burned, error: burnError } = await admin
      .from('agent_oauth_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code_hash', row.code_hash)
      .is('used_at', null)
      .select('code_hash')
      .maybeSingle()
    if (burnError) return json(oauthError('server_error', burnError.message), 500)
    if (!burned) return json(oauthError('invalid_grant', 'code already used'), 400)

    if (new Date(row.expires_at).getTime() < Date.now())
      return json(oauthError('invalid_grant', 'code expired'), 400)
    if (row.client_id !== clientId)
      return json(oauthError('invalid_grant', 'code was issued to a different client'), 400)
    if (row.redirect_uri !== redirectUri)
      return json(oauthError('invalid_grant', 'redirect_uri mismatch'), 400)
    if (!verifyPkceS256(verifier, row.code_challenge))
      return json(oauthError('invalid_grant', 'PKCE verification failed'), 400)

    const tokens = await issueTokens(admin, {
      clientId,
      clientName: client.client_name,
      approvedBy: row.approved_by,
    })
    if (!tokens) return json(oauthError('server_error', 'could not issue tokens'), 500)
    return json(tokens)
  }

  // ── refresh_token (rotating) ──────────────────────────────────────────
  if (grantType === 'refresh_token') {
    const { refresh_token: refreshToken, client_id: clientId } = p
    if (!refreshToken) return json(oauthError('invalid_request', 'refresh_token is required'), 400)

    const { data: key, error } = await admin
      .from('agent_keys')
      .select('id, client_id, approved_by, revoked_at')
      .eq('refresh_hash', sha256Hex(refreshToken))
      .is('revoked_at', null)
      .maybeSingle()
    if (error) return json(oauthError('server_error', error.message), 500)
    if (!key) return json(oauthError('invalid_grant', 'unknown or revoked refresh token'), 400)
    if (clientId && key.client_id !== clientId)
      return json(oauthError('invalid_grant', 'client mismatch'), 400)

    const client = await findClient(admin, key.client_id as string)
    if (!client) return json(oauthError('invalid_client', 'client no longer registered'), 401)

    // Rotate in place: the old access AND refresh token stop working.
    const tokens = await issueTokens(admin, {
      clientId: key.client_id as string,
      clientName: client.client_name,
      approvedBy: (key.approved_by as string | null) ?? null,
      keyId: key.id as string,
    })
    if (!tokens) return json(oauthError('server_error', 'could not rotate tokens'), 500)
    return json(tokens)
  }

  return json(oauthError('unsupported_grant_type', `unsupported grant_type: ${grantType}`), 400)
}
