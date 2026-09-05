import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * OAuth `state` for /api/xero/connect → /api/xero/callback. The connect route
 * sets an httpOnly cookie holding sha256(state) (never the state itself) and
 * sends the plaintext state to Xero; the callback compares timing-safely.
 */
export const XERO_STATE_COOKIE = 'xero_oauth_state'
export const XERO_STATE_TTL_SECONDS = 600

export function newOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

export function oauthStateMatches(
  state: string | null,
  cookieHash: string | undefined
): boolean {
  if (!state || !cookieHash) return false
  const a = Buffer.from(hashOAuthState(state), 'utf8')
  const b = Buffer.from(cookieHash, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
