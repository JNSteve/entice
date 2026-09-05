import { XERO_API_BASE } from './config'
import { xeroErrorMessage } from './map'
import type { Admin } from './register'
import { getValidAccessToken } from './tokens'

/**
 * Minimal Xero Accounting API client. Behaviour (tests/xero-client.test.ts):
 *  - Authorization: Bearer + xero-tenant-id + Accept: application/json.
 *  - 401 → refresh ONCE via deps.refresh, retry once.
 *  - 429 → sleep Retry-After seconds (cap 60) ONCE, retry once; a second 429
 *    throws XeroRateLimitError so the caller ends the run as 'partial'.
 *  - Any other non-2xx → XeroApiError with Xero's validation message.
 * Xero's limits: 60 calls/min, 5000/day per org, 5 concurrent — we call
 * sequentially and never parallelise.
 */

export class XeroApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? xeroErrorMessage(body))
    this.name = 'XeroApiError'
    this.status = status
    this.body = body
  }
}

export class XeroRateLimitError extends XeroApiError {
  constructor(body: unknown) {
    super(429, body, 'Xero rate limit reached — the sync will resume on the next run')
    this.name = 'XeroRateLimitError'
  }
}

export type XeroAuth = { accessToken: string; tenantId: string; expiresAt?: number }

export type XeroApiDeps = {
  getAuth: () => Promise<XeroAuth>
  refresh: () => Promise<XeroAuth>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type XeroRequestOptions = { headers?: Record<string, string> }

export type XeroApi = {
  get<T>(path: string, opts?: XeroRequestOptions): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
  put<T>(path: string, body: unknown): Promise<T>
  postNoContent(path: string): Promise<void>
}

const MAX_RETRY_AFTER_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000

export function createXeroApi(deps: XeroApiDeps): XeroApi {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: XeroRequestOptions
  ): Promise<T> {
    let auth = await deps.getAuth()
    let refreshed = false
    let waited = false

    for (;;) {
      const res = await doFetch(`${XERO_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'xero-tenant-id': auth.tenantId,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(opts?.headers ?? {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 401 && !refreshed) {
        refreshed = true
        auth = await deps.refresh()
        continue
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '5')
        const ms = Math.min(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000,
          MAX_RETRY_AFTER_MS
        )
        if (!waited) {
          waited = true
          await sleep(ms)
          continue
        }
        throw new XeroRateLimitError(await res.json().catch(() => null))
      }
      if (res.status === 204) return undefined as T
      const parsed = await res.json().catch(() => null)
      if (!res.ok) throw new XeroApiError(res.status, parsed)
      return parsed as T
    }
  }

  return {
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    postNoContent: (path) => request<void>('POST', path),
  }
}

const AUTH_CACHE_MARGIN_MS = 5 * 60_000

/**
 * The real thing: tokens from xero_connection via the service-role client.
 * The auth is cached in the closure so a sync of hundreds of requests decrypts
 * and re-reads the connection row once, not once per call; a 401 refresh
 * replaces the cache.
 */
export function xeroApiForAdmin(admin: Admin): XeroApi {
  let cached: XeroAuth | null = null
  return createXeroApi({
    getAuth: async () => {
      if (cached?.expiresAt && Date.now() < cached.expiresAt - AUTH_CACHE_MARGIN_MS) return cached
      cached = await getValidAccessToken(admin)
      return cached
    },
    refresh: async () => {
      cached = null
      cached = await getValidAccessToken(admin, { forceRefresh: true })
      return cached
    },
  })
}
