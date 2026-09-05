/**
 * Xero integration — constants and environment.
 *
 * THE SCOPE STRING IS A CONTRACT (spec §3). Sales invoices, payments,
 * contacts and settings (accounts / tax rates / tracking) only. No payroll,
 * bank, reports, journals or attachments — ever. tests/xero-config.test.ts
 * pins it.
 */

export const XERO_SCOPES =
  'offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings'

export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

export type XeroEnv = { clientId: string; clientSecret: string; tokenKey: string }

/** All three secrets, or null when any is missing (integration unavailable). */
export function xeroEnv(): XeroEnv | null {
  const clientId = process.env.XERO_CLIENT_ID?.trim()
  const clientSecret = process.env.XERO_CLIENT_SECRET?.trim()
  const tokenKey = process.env.XERO_TOKEN_KEY?.trim()
  if (!clientId || !clientSecret || !tokenKey) return null
  return { clientId, clientSecret, tokenKey }
}

export function xeroConfigured(): boolean {
  return xeroEnv() !== null
}

/** Must match a redirect URI registered on the Xero app, character for character. */
export function xeroRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  )
  return `${base}/api/xero/callback`
}
