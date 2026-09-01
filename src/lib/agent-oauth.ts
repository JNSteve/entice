import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Agent API OAuth — pure layer (PKCE, validation, discovery documents).
 *
 * The MCP endpoint needs OAuth because claude.ai account connectors (Cowork,
 * the mobile app) cannot send a static bearer header. Public client + PKCE S256
 * only; tokens are stored hashed as agent_keys rows so the existing audit trail
 * and revocation keep working.
 * Design: docs/superpowers/specs/2026-09-01-agent-oauth-design.md
 */

/**
 * Access tokens live 1 hour. Refresh tokens carry no independent expiry: they
 * are rotated on every use and die when the grant is revoked (revoked_at), so
 * revocation is the single control for ending access.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 3600
/** Authorization codes are single-use and very short-lived. */
export const AUTH_CODE_TTL_SECONDS = 60

export const OAUTH_BASE = '/api/agent/oauth'
export const MCP_PATH = '/api/agent/mcp'

/** sha256 hex — how every code/token is stored at rest. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** URL-safe random secret (tokens, codes, client ids). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Verify a PKCE code_verifier against the stored S256 challenge.
 * Constant-time compare; `plain` is deliberately not supported.
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  // RFC 7636: verifier is 43-128 chars of [A-Za-z0-9-._~]
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  const computed = createHash('sha256').update(verifier, 'utf8').digest('base64url')
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Redirect URIs must match a registered value EXACTLY (no prefix matching,
 * which is the classic OAuth redirect hijack).
 */
export function isRegisteredRedirect(uri: string, registered: string[]): boolean {
  return registered.includes(uri)
}

/**
 * Registration-time redirect_uri check: absolute https, or the loopback/custom
 * schemes native and desktop clients legitimately use.
 */
export function isAcceptableRedirectUri(uri: string): boolean {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))
    return true
  // Custom scheme (e.g. claude://…) — must not be http-ish.
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && u.protocol !== 'http:'
}

/**
 * Only same-origin relative paths may be used as a post-login return target,
 * so the added `next` support can't become an open redirect.
 */
export function isSafeNextPath(next: string): boolean {
  return (
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.startsWith('/\\') &&
    !next.includes('\n') &&
    !next.includes('\r')
  )
}

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'server_error'

/** RFC 6749 §5.2 error body. */
export function oauthError(code: OAuthErrorCode, description?: string) {
  return description
    ? { error: code, error_description: description }
    : { error: code }
}

/** RFC 8414 — authorization server metadata. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_BASE}/authorize`,
    token_endpoint: `${origin}${OAUTH_BASE}/token`,
    registration_endpoint: `${origin}${OAUTH_BASE}/register`,
    scopes_supported: ['agent'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: `${origin}${MCP_PATH}`,
  }
}

/** RFC 9728 — protected resource metadata. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: ['agent'],
    bearer_methods_supported: ['header'],
    resource_name: 'ECR portal agent API',
    resource_documentation: `${origin}${MCP_PATH}`,
  }
}

/** WWW-Authenticate value pointing clients at discovery (MCP auth spec). */
export function wwwAuthenticate(origin: string, error = 'invalid_token'): string {
  return `Bearer error="${error}", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
}

/** Minimal HTML escape for the server-rendered consent page. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
