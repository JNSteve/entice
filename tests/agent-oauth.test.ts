import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  authorizationServerMetadata,
  escapeHtml,
  isAcceptableRedirectUri,
  isRegisteredRedirect,
  isSafeNextPath,
  protectedResourceMetadata,
  randomToken,
  sha256Hex,
  verifyPkceS256,
  wwwAuthenticate,
} from '@/lib/agent-oauth'

const ORIGIN = 'https://entice-pink.vercel.app'

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url')
  return { verifier, challenge }
}

describe('verifyPkceS256', () => {
  it('accepts a correct verifier/challenge pair', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it('rejects a wrong verifier', () => {
    const { challenge } = pkcePair()
    const other = randomBytes(32).toString('base64url')
    expect(verifyPkceS256(other, challenge)).toBe(false)
  })

  it('rejects empty input and malformed verifiers', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifyPkceS256('', challenge)).toBe(false)
    expect(verifyPkceS256(verifier, '')).toBe(false)
    expect(verifyPkceS256('short', challenge)).toBe(false)
    expect(verifyPkceS256('a'.repeat(129), challenge)).toBe(false)
    expect(verifyPkceS256('has spaces and !!', challenge)).toBe(false)
  })

  it('does NOT accept a plain (unhashed) verifier as its own challenge', () => {
    // Guards against accidentally supporting code_challenge_method=plain.
    const verifier = randomBytes(32).toString('base64url')
    expect(verifyPkceS256(verifier, verifier)).toBe(false)
  })
})

describe('redirect URI validation', () => {
  it('requires an exact match against registered URIs (no prefix matching)', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback']
    expect(isRegisteredRedirect('https://claude.ai/api/mcp/auth_callback', registered)).toBe(true)
    // Classic hijack shapes that prefix matching would wrongly allow:
    expect(isRegisteredRedirect('https://claude.ai/api/mcp/auth_callback/../evil', registered)).toBe(false)
    expect(isRegisteredRedirect('https://claude.ai/api/mcp/auth_callback?x=1', registered)).toBe(false)
    expect(isRegisteredRedirect('https://evil.com/api/mcp/auth_callback', registered)).toBe(false)
    expect(isRegisteredRedirect('https://claude.ai.evil.com/', registered)).toBe(false)
  })

  it('accepts https, loopback http and custom schemes at registration', () => {
    expect(isAcceptableRedirectUri('https://claude.ai/callback')).toBe(true)
    expect(isAcceptableRedirectUri('http://localhost:3000/cb')).toBe(true)
    expect(isAcceptableRedirectUri('http://127.0.0.1:8080/cb')).toBe(true)
    expect(isAcceptableRedirectUri('claude://oauth/callback')).toBe(true)
  })

  it('rejects plaintext http on a public host, junk and fragments', () => {
    expect(isAcceptableRedirectUri('http://evil.com/cb')).toBe(false)
    expect(isAcceptableRedirectUri('not a url')).toBe(false)
    expect(isAcceptableRedirectUri('https://claude.ai/cb#frag')).toBe(false)
  })
})

describe('isSafeNextPath (open-redirect guard on login ?next=)', () => {
  it('allows same-origin relative paths', () => {
    expect(isSafeNextPath('/api/agent/oauth/authorize?client_id=x')).toBe(true)
    expect(isSafeNextPath('/')).toBe(true)
  })

  it('rejects anything that could leave the origin', () => {
    expect(isSafeNextPath('//evil.com')).toBe(false)
    expect(isSafeNextPath('https://evil.com')).toBe(false)
    expect(isSafeNextPath('/\\evil.com')).toBe(false)
    expect(isSafeNextPath('evil.com')).toBe(false)
    expect(isSafeNextPath('/ok\nSet-Cookie: x=1')).toBe(false)
  })
})

describe('discovery documents', () => {
  it('authorization server metadata advertises PKCE S256 and no client secret', () => {
    const m = authorizationServerMetadata(ORIGIN)
    expect(m.issuer).toBe(ORIGIN)
    expect(m.code_challenge_methods_supported).toEqual(['S256'])
    expect(m.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(m.grant_types_supported).toContain('authorization_code')
    expect(m.grant_types_supported).toContain('refresh_token')
    expect(m.authorization_endpoint).toBe(`${ORIGIN}/api/agent/oauth/authorize`)
    expect(m.token_endpoint).toBe(`${ORIGIN}/api/agent/oauth/token`)
    expect(m.registration_endpoint).toBe(`${ORIGIN}/api/agent/oauth/register`)
  })

  it('protected resource metadata points at the MCP endpoint and this issuer', () => {
    const m = protectedResourceMetadata(ORIGIN)
    expect(m.resource).toBe(`${ORIGIN}/api/agent/mcp`)
    expect(m.authorization_servers).toEqual([ORIGIN])
  })

  it('WWW-Authenticate carries the resource_metadata pointer', () => {
    expect(wwwAuthenticate(ORIGIN)).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`
    )
  })
})

describe('token helpers', () => {
  it('sha256Hex matches a known digest', () => {
    expect(sha256Hex('test')).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    )
  })

  it('randomToken is url-safe and unique', () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(40)
  })
})

describe('escapeHtml (consent page injection guard)', () => {
  it('escapes the characters that could break out of markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    )
    expect(escapeHtml("it's")).toBe('it&#39;s')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })
})
