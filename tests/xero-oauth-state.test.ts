import { describe, expect, test } from 'vitest'
import {
  XERO_STATE_COOKIE,
  XERO_STATE_TTL_SECONDS,
  hashOAuthState,
  newOAuthState,
  oauthStateMatches,
} from '../src/lib/xero/oauth-state'

describe('xero oauth state', () => {
  test('state is url-safe and long enough', () => {
    const s = newOAuthState()
    expect(s).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(newOAuthState()).not.toBe(s)
  })

  test('hash verifies only the original state', () => {
    const s = newOAuthState()
    const h = hashOAuthState(s)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(oauthStateMatches(s, h)).toBe(true)
    expect(oauthStateMatches(newOAuthState(), h)).toBe(false)
    expect(oauthStateMatches(null, h)).toBe(false)
    expect(oauthStateMatches(s, undefined)).toBe(false)
    expect(oauthStateMatches(s, 'zz')).toBe(false)
  })

  test('cookie constants', () => {
    expect(XERO_STATE_COOKIE).toBe('xero_oauth_state')
    expect(XERO_STATE_TTL_SECONDS).toBe(600)
  })
})
