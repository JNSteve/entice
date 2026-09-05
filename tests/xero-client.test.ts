import { describe, expect, test, vi } from 'vitest'
import { XeroApiError, XeroRateLimitError, createXeroApi } from '../src/lib/xero/client'

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function makeApi(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const refresh = vi.fn(async () => ({ accessToken: 'fresh', tenantId: 't1' }))
  const sleep = vi.fn(async () => {})
  const api = createXeroApi({
    getAuth: async () => ({ accessToken: 'stale', tenantId: 't1' }),
    refresh,
    fetch: fetchImpl as unknown as typeof fetch,
    sleep,
  })
  return { api, refresh, sleep }
}

describe('createXeroApi', () => {
  test('sends bearer + tenant + json headers and parses the body', async () => {
    const seen: RequestInit[] = []
    const { api } = makeApi(async (url, init) => {
      seen.push(init)
      expect(url).toBe('https://api.xero.com/api.xro/2.0/Organisation')
      return response(200, { Organisations: [{ Name: 'Demo' }] })
    })
    const body = await api.get<{ Organisations: { Name: string }[] }>('/Organisation')
    expect(body.Organisations[0].Name).toBe('Demo')
    const h = seen[0].headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer stale')
    expect(h['xero-tenant-id']).toBe('t1')
    expect(h.Accept).toBe('application/json')
  })

  test('401 → refresh once → retry with the new token', async () => {
    const tokens: string[] = []
    const { api, refresh } = makeApi(async (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      tokens.push(auth)
      return auth === 'Bearer fresh' ? response(200, { ok: true }) : response(401, { Detail: 'TokenExpired' })
    })
    await expect(api.get('/Invoices')).resolves.toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(tokens).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  test('a second 401 after refresh surfaces as XeroApiError(401)', async () => {
    const { api } = makeApi(async () => response(401, { Detail: 'nope' }))
    await expect(api.get('/Invoices')).rejects.toMatchObject({ status: 401, message: 'nope' })
  })

  test('429 → waits Retry-After (capped at 60s) once → retries', async () => {
    let calls = 0
    const { api, sleep } = makeApi(async () => {
      calls++
      return calls === 1
        ? response(429, null, { 'retry-after': '7' })
        : response(200, { Invoices: [] })
    })
    await expect(api.get('/Invoices')).resolves.toEqual({ Invoices: [] })
    expect(sleep).toHaveBeenCalledWith(7000)
  })

  test('two 429s in a row → XeroRateLimitError', async () => {
    const { api, sleep } = makeApi(async () => response(429, null, { 'retry-after': '500' }))
    await expect(api.get('/Invoices')).rejects.toBeInstanceOf(XeroRateLimitError)
    expect(sleep).toHaveBeenCalledWith(60000)
  })

  test('400 validation errors are readable', async () => {
    const { api } = makeApi(async () =>
      response(400, { Elements: [{ ValidationErrors: [{ Message: 'Invoice # must be unique.' }] }] })
    )
    const err = (await api.post('/Invoices', { Invoices: [] }).catch((e: unknown) => e)) as XeroApiError
    expect(err).toBeInstanceOf(XeroApiError)
    expect(err.message).toBe('Invoice # must be unique.')
    expect(err.status).toBe(400)
  })

  test('postNoContent accepts 204 and posts an empty body', async () => {
    const { api } = makeApi(async (_url, init) => {
      expect(init.method).toBe('POST')
      expect(init.body).toBeUndefined()
      return new Response(null, { status: 204 })
    })
    await expect(api.postNoContent('/Invoices/abc/Email')).resolves.toBeUndefined()
  })

  test('get passes extra headers through (If-Modified-Since)', async () => {
    const seen: RequestInit[] = []
    const { api } = makeApi(async (_url, init) => {
      seen.push(init)
      return response(200, { Contacts: [] })
    })
    await api.get('/Contacts', { headers: { 'If-Modified-Since': '2026-09-05T00:00:00' } })
    const h = seen[0].headers as Record<string, string>
    expect(h['If-Modified-Since']).toBe('2026-09-05T00:00:00')
    expect(h.Authorization).toBe('Bearer stale')
  })
})
