import { afterEach, describe, expect, test } from 'vitest'
import {
  XERO_API_BASE,
  XERO_AUTHORIZE_URL,
  XERO_SCOPES,
  XERO_TOKEN_URL,
  xeroConfigured,
  xeroEnv,
  xeroRedirectUri,
} from '../src/lib/xero/config'

const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

describe('xero config', () => {
  test('scope string is exactly the five approved scopes (spec §3)', () => {
    expect(XERO_SCOPES).toBe(
      'offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings'
    )
    expect(XERO_SCOPES).not.toMatch(/payroll|bank|reports|journals|attachments|transactions/)
  })

  test('endpoints are the Xero identity + accounting hosts', () => {
    expect(XERO_AUTHORIZE_URL).toBe('https://login.xero.com/identity/connect/authorize')
    expect(XERO_TOKEN_URL).toBe('https://identity.xero.com/connect/token')
    expect(XERO_API_BASE).toBe('https://api.xero.com/api.xro/2.0')
  })

  test('redirect URI is derived from NEXT_PUBLIC_APP_URL without a double slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://entice-pink.vercel.app/'
    expect(xeroRedirectUri()).toBe('https://entice-pink.vercel.app/api/xero/callback')
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(xeroRedirectUri()).toBe('http://localhost:3000/api/xero/callback')
  })

  test('xeroEnv is null unless all three vars are present', () => {
    delete process.env.XERO_CLIENT_ID
    process.env.XERO_CLIENT_SECRET = 's'
    process.env.XERO_TOKEN_KEY = 'k'
    expect(xeroEnv()).toBeNull()
    expect(xeroConfigured()).toBe(false)
    process.env.XERO_CLIENT_ID = 'id'
    expect(xeroEnv()).toEqual({ clientId: 'id', clientSecret: 's', tokenKey: 'k' })
    expect(xeroConfigured()).toBe(true)
  })
})
