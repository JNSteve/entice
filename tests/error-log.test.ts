import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_MESSAGE_CHARS,
  MAX_PATH_CHARS,
  MAX_STACK_CHARS,
  isLocalDevelopment,
  reportAppError,
  trimErrorText,
} from '../src/lib/error-log'

test('null/undefined/empty/whitespace collapse to null', () => {
  expect(trimErrorText(null, 100)).toBeNull()
  expect(trimErrorText(undefined, 100)).toBeNull()
  expect(trimErrorText('', 100)).toBeNull()
  expect(trimErrorText('   \n\t ', 100)).toBeNull()
})

test('short text passes through trimmed', () => {
  expect(trimErrorText('  boom  ', 100)).toBe('boom')
})

test('long stacks are hard-capped at the limit', () => {
  const stack = 'x'.repeat(5000)
  const trimmed = trimErrorText(stack, MAX_STACK_CHARS)
  expect(trimmed).toHaveLength(4000)
  expect(MAX_STACK_CHARS).toBe(4000)
})

test('text exactly at the limit is untouched', () => {
  const exact = 'y'.repeat(MAX_MESSAGE_CHARS)
  expect(trimErrorText(exact, MAX_MESSAGE_CHARS)).toBe(exact)
})

test('trim happens before the cap (whitespace does not count)', () => {
  const padded = `  ${'z'.repeat(MAX_PATH_CHARS)}  `
  expect(trimErrorText(padded, MAX_PATH_CHARS)).toHaveLength(MAX_PATH_CHARS)
})

// Local development must never write into the production register:
// .env.local points at the live Supabase project, so without a guard every
// Turbopack hot-reload mid-edit ReferenceError lands in Settings → Errors as
// an open client row (six did on 2026-10-23).
describe('isLocalDevelopment', () => {
  test('next dev (NODE_ENV=development) is local on both runtimes', () => {
    expect(isLocalDevelopment('development', null)).toBe(true)
    expect(isLocalDevelopment('development', 'entice-pink.vercel.app')).toBe(true)
  })

  test('a production build served from the live host is not local', () => {
    expect(isLocalDevelopment('production', 'entice-pink.vercel.app')).toBe(false)
  })

  test('a production build served from a loopback host is local', () => {
    expect(isLocalDevelopment('production', 'localhost')).toBe(true)
    expect(isLocalDevelopment('production', '127.0.0.1')).toBe(true)
    expect(isLocalDevelopment('production', '[::1]')).toBe(true)
  })

  test('server side (no hostname) outside next dev is not local', () => {
    expect(isLocalDevelopment('production', null)).toBe(false)
    expect(isLocalDevelopment('test', undefined)).toBe(false)
  })
})

describe('reportAppError', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('posts to log_app_error outside local development', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await reportAppError({ source: 'client', path: '/x', message: 'boom' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.supabase.co/rest/v1/rpc/log_app_error'
    )
  })

  test('is silent under next dev so HMR errors stay out of the register', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await reportAppError({ source: 'client', path: '/x', message: 'justAdded is not defined' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
