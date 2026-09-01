import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCESS_TOKEN_TTL_SECONDS, randomToken, sha256Hex } from '@/lib/agent-oauth'

/**
 * Agent API OAuth — server helpers (origin resolution, client lookup, token
 * issue/rotation). Tokens are issued as agent_keys rows (kind='oauth') so
 * revocation and the agent_audit trail work exactly as they do for static keys.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>

/**
 * Public origin of this deployment. Prefers the forwarded headers Vercel sets
 * so the issued metadata matches the host the client actually called.
 */
export function requestOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? url.host
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
}

export type OAuthClient = {
  client_id: string
  client_name: string | null
  redirect_uris: string[]
}

export async function findClient(
  admin: Admin,
  clientId: string
): Promise<OAuthClient | null> {
  const { data, error } = await admin
    .from('agent_oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .is('disabled_at', null)
    .maybeSingle()
  if (error || !data) return null
  return data as OAuthClient
}

export type IssuedTokens = {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

/**
 * Issue a fresh access/refresh pair as an agent_keys row. Returns the plaintext
 * tokens (the only time they exist outside the client) — only hashes are stored.
 */
export async function issueTokens(
  admin: Admin,
  opts: {
    clientId: string
    clientName: string | null
    approvedBy: string | null
    /** Existing key row to rotate in place (refresh flow), or null to create. */
    keyId?: string | null
  }
): Promise<IssuedTokens | null> {
  const accessToken = randomToken(32)
  const refreshToken = randomToken(32)
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()

  const row = {
    name: `oauth: ${opts.clientName ?? opts.clientId}`,
    kind: 'oauth' as const,
    client_id: opts.clientId,
    key_hash: sha256Hex(accessToken),
    refresh_hash: sha256Hex(refreshToken),
    expires_at: expiresAt,
    approved_by: opts.approvedBy,
  }

  if (opts.keyId) {
    const { error } = await admin
      .from('agent_keys')
      .update({ ...row, revoked_at: null })
      .eq('id', opts.keyId)
    if (error) return null
  } else {
    const { error } = await admin.from('agent_keys').insert(row)
    if (error) return null
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: 'agent',
  }
}
