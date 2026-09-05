import { renderEmail, sendEmail } from '@/lib/email'
import { XERO_CONNECTIONS_URL, XERO_TOKEN_URL, xeroEnv, xeroRedirectUri } from './config'
import { decryptSecret, encryptSecret } from './crypto'
import type { Admin } from './register'

/**
 * Token lifecycle for the single Xero connection.
 *  - Access tokens live 30 min; refresh tokens rotate on every refresh and die
 *    after 60 days idle (the nightly sync keeps them warm).
 *  - Both are stored AES-256-GCM encrypted (crypto.ts). Nothing here ever
 *    returns a token to a caller outside src/lib/xero.
 *  - A failed refresh (invalid_grant) flips status → needs_reconnect and
 *    emails the office (spec §5.4 step 1).
 */

export type TokenSet = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

export type XeroTenant = {
  id: string // connection id
  tenantId: string
  tenantName?: string
  tenantType?: string
}

export type XeroConnectionRow = {
  id: number
  tenant_id: string | null
  tenant_name: string | null
  connection_id: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  access_expires_at: string | null
  scopes: string | null
  status: 'connected' | 'needs_reconnect' | 'disconnected'
  connected_by: string | null
  connected_at: string | null
  last_refresh_at: string | null
  last_sync_at: string | null
  last_sync_status: string | null
}

/** The page-safe subset: no token columns. */
export type XeroConnection = Omit<
  XeroConnectionRow,
  'access_token_enc' | 'refresh_token_enc' | 'id'
>

const REFRESH_AHEAD_MS = 5 * 60 * 1000

function basicAuth(): string {
  const env = xeroEnv()
  if (!env) throw new Error('Xero is not configured on this deployment')
  return 'Basic ' + Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64')
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => null)) as
    | (TokenSet & { error?: string; error_description?: string })
    | null
  if (!res.ok || !body?.access_token || !body.refresh_token) {
    const reason = body?.error_description ?? body?.error ?? `HTTP ${res.status}`
    const err = new Error(`Xero token request failed: ${reason}`)
    ;(err as Error & { code?: string }).code = body?.error
    throw err
  }
  return body
}

export function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: xeroRedirectUri(),
  })
}

export function refreshTokenSet(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function listConnections(accessToken: string): Promise<XeroTenant[]> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Could not list Xero connections (HTTP ${res.status})`)
  return (await res.json()) as XeroTenant[]
}

export async function deleteConnection(accessToken: string, connectionId: string): Promise<void> {
  const res = await fetch(`${XERO_CONNECTIONS_URL}/${connectionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Could not disconnect from Xero (HTTP ${res.status})`)
  }
}

export async function loadConnection(admin: Admin): Promise<XeroConnectionRow | null> {
  const { data, error } = await admin.from('xero_connection').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(`Could not read the Xero connection: ${error.message}`)
  return (data as XeroConnectionRow | null) ?? null
}

export async function getConnectionSummary(admin: Admin): Promise<XeroConnection | null> {
  const row = await loadConnection(admin)
  if (!row) return null
  // Strip the encrypted blobs before anything leaves this module.
  const { access_token_enc, refresh_token_enc, id, ...safe } = row
  void access_token_enc
  void refresh_token_enc
  void id
  return safe
}

export async function storeTokenSet(
  admin: Admin,
  tokens: TokenSet,
  extra: Partial<
    Pick<
      XeroConnectionRow,
      'tenant_id' | 'tenant_name' | 'connection_id' | 'connected_by' | 'connected_at' | 'status'
    >
  > = {}
): Promise<void> {
  const env = xeroEnv()
  if (!env) throw new Error('Xero is not configured on this deployment')
  const { error } = await admin
    .from('xero_connection')
    .update({
      access_token_enc: encryptSecret(tokens.access_token, env.tokenKey),
      refresh_token_enc: encryptSecret(tokens.refresh_token, env.tokenKey),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ?? null,
      last_refresh_at: new Date().toISOString(),
      status: 'connected',
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq('id', 1)
  if (error) throw new Error(`Could not store Xero tokens: ${error.message}`)
}

export async function markNeedsReconnect(admin: Admin, reason: string): Promise<void> {
  const { error } = await admin
    .from('xero_connection')
    .update({
      status: 'needs_reconnect',
      access_token_enc: null,
      refresh_token_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) console.error('[xero] could not mark the connection needs_reconnect:', error.message)

  // Office alert (skip-logged until email is configured; never throws).
  const { data: settings } = await admin
    .from('settings')
    .select('company_name, email')
    .eq('id', 1)
    .single()
  await sendEmail({
    to: settings?.email ?? null,
    subject: 'Xero needs reconnecting',
    template: 'office_xero_reconnect',
    entityKind: 'xero_connection',
    html: renderEmail({
      companyName: settings?.company_name ?? 'Entice',
      heading: 'Xero needs reconnecting',
      intro: `ECR could not refresh its Xero access (${reason}). Invoices cannot be sent via Xero and the nightly sync is paused until an admin reconnects.`,
      cta: process.env.NEXT_PUBLIC_APP_URL
        ? { label: 'Open Settings → Xero', url: `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/settings?tab=xero` }
        : null,
    }),
  })
}

export async function clearConnection(admin: Admin): Promise<void> {
  const { error } = await admin
    .from('xero_connection')
    .update({
      access_token_enc: null,
      refresh_token_enc: null,
      access_expires_at: null,
      connection_id: null,
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) throw new Error(`Could not clear the Xero connection: ${error.message}`)
}

/**
 * Decrypt the current access token, refreshing first when it is within five
 * minutes of expiry. Throws when the connection is not usable; on a refresh
 * failure marks needs_reconnect before throwing. `expiresAt` (ms epoch) lets
 * callers cache the result instead of re-reading the row on every request.
 */
export async function getValidAccessToken(
  admin: Admin,
  opts: { forceRefresh?: boolean } = {}
): Promise<{ accessToken: string; tenantId: string; expiresAt: number }> {
  const env = xeroEnv()
  if (!env) throw new Error('Xero is not configured on this deployment')
  const row = await loadConnection(admin)
  if (!row || row.status !== 'connected' || !row.refresh_token_enc || !row.tenant_id) {
    throw new Error('Xero is not connected')
  }

  const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : 0
  const needsRefresh =
    opts.forceRefresh || !row.access_token_enc || expiresAt - Date.now() < REFRESH_AHEAD_MS

  if (!needsRefresh) {
    return {
      accessToken: decryptSecret(row.access_token_enc!, env.tokenKey),
      tenantId: row.tenant_id,
      expiresAt,
    }
  }

  try {
    const fresh = await refreshTokenSet(decryptSecret(row.refresh_token_enc, env.tokenKey))
    await storeTokenSet(admin, fresh)
    // Xero access tokens live 30 minutes; assume 25 to stay conservative.
    return {
      accessToken: fresh.access_token,
      tenantId: row.tenant_id,
      expiresAt: Date.now() + 25 * 60_000,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if ((err as { code?: string }).code === 'invalid_grant' || /invalid_grant/.test(message)) {
      await markNeedsReconnect(admin, message)
    }
    throw err
  }
}
