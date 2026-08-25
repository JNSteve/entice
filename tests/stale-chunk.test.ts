import { describe, expect, test, vi } from 'vitest'
import {
  isStaleChunkError,
  isReloadBlocked,
  tryBeginAutoReload,
  maybeStaleChunkReload,
  RELOAD_COOLDOWN_MS,
  RELOAD_STORAGE_KEY,
} from '../src/lib/stale-chunk'

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal Storage stand-in backed by a Map. */
function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
    dump: () => Object.fromEntries(m),
  }
}

const NOW = 1_756_000_000_000

// The exact production error from the 2026-08-25 incident (turbopack build).
const TURBOPACK_CHUNK_ERROR = {
  name: 'ChunkLoadError',
  message:
    'Failed to load chunk /_next/static/chunks/0shfufsib1dqr.js from module 964893',
}

// ─── isStaleChunkError ───────────────────────────────────────────────────────

describe('isStaleChunkError', () => {
  test('matches the turbopack chunk error from the incident', () => {
    expect(isStaleChunkError(TURBOPACK_CHUNK_ERROR)).toBe(true)
  })

  test('matches by ChunkLoadError name regardless of message', () => {
    expect(isStaleChunkError({ name: 'ChunkLoadError', message: 'whatever' })).toBe(
      true
    )
  })

  test('matches webpack "Loading chunk N failed" without the name', () => {
    expect(
      isStaleChunkError({
        name: 'Error',
        message:
          'Loading chunk 42 failed.\n(error: https://app.example/_next/static/chunks/42-abc123.js)',
      })
    ).toBe(true)
  })

  test('matches CSS chunk load failures', () => {
    expect(
      isStaleChunkError({
        name: 'Error',
        message: 'Loading CSS chunk 3 failed (/_next/static/css/app-1a2b.css)',
      })
    ).toBe(true)
  })

  test('matches dynamic import failures across browsers', () => {
    // Chrome
    expect(
      isStaleChunkError({
        name: 'TypeError',
        message:
          'Failed to fetch dynamically imported module: https://app.example/_next/static/chunks/dialog.js',
      })
    ).toBe(true)
    // Firefox
    expect(
      isStaleChunkError({
        name: 'TypeError',
        message: 'error loading dynamically imported module',
      })
    ).toBe(true)
    // Safari
    expect(
      isStaleChunkError({
        name: 'TypeError',
        message: 'Importing a module script failed.',
      })
    ).toBe(true)
  })

  test('does NOT match a plain network failure', () => {
    expect(isStaleChunkError({ name: 'TypeError', message: 'Failed to fetch' })).toBe(
      false
    )
  })

  test('does NOT match unrelated errors or empty errors', () => {
    expect(isStaleChunkError({ name: 'Error', message: 'boom' })).toBe(false)
    expect(isStaleChunkError({})).toBe(false)
  })
})

// ─── isReloadBlocked ─────────────────────────────────────────────────────────

describe('isReloadBlocked', () => {
  test('no prior attempt: not blocked, and reads without writing', () => {
    const storage = fakeStorage()
    expect(isReloadBlocked(storage, NOW)).toBe(false)
    expect(storage.dump()).toEqual({})
  })

  test('attempt within the cooldown: blocked', () => {
    const storage = fakeStorage({ [RELOAD_STORAGE_KEY]: String(NOW - 10_000) })
    expect(isReloadBlocked(storage, NOW)).toBe(true)
  })

  test('attempt past the cooldown: not blocked', () => {
    const storage = fakeStorage({
      [RELOAD_STORAGE_KEY]: String(NOW - RELOAD_COOLDOWN_MS),
    })
    expect(isReloadBlocked(storage, NOW)).toBe(false)
  })

  test('unreadable storage: blocked (loop safety)', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {},
    }
    expect(isReloadBlocked(storage, NOW)).toBe(true)
  })
})

// ─── tryBeginAutoReload ──────────────────────────────────────────────────────

describe('tryBeginAutoReload', () => {
  test('first attempt: allows and records the timestamp', () => {
    const storage = fakeStorage()
    expect(tryBeginAutoReload(storage, NOW)).toBe(true)
    expect(storage.dump()[RELOAD_STORAGE_KEY]).toBe(String(NOW))
  })

  test('attempt within the cooldown: blocks and leaves the timestamp alone', () => {
    const recent = NOW - 10_000
    const storage = fakeStorage({ [RELOAD_STORAGE_KEY]: String(recent) })
    expect(tryBeginAutoReload(storage, NOW)).toBe(false)
    expect(storage.dump()[RELOAD_STORAGE_KEY]).toBe(String(recent))
  })

  test('attempt after the cooldown: allows again and re-records', () => {
    const old = NOW - RELOAD_COOLDOWN_MS - 1
    const storage = fakeStorage({ [RELOAD_STORAGE_KEY]: String(old) })
    expect(tryBeginAutoReload(storage, NOW)).toBe(true)
    expect(storage.dump()[RELOAD_STORAGE_KEY]).toBe(String(NOW))
  })

  test('exactly at the cooldown boundary: allows', () => {
    const storage = fakeStorage({
      [RELOAD_STORAGE_KEY]: String(NOW - RELOAD_COOLDOWN_MS),
    })
    expect(tryBeginAutoReload(storage, NOW)).toBe(true)
  })

  test('garbage stored value: treated as never attempted', () => {
    const storage = fakeStorage({ [RELOAD_STORAGE_KEY]: 'not-a-number' })
    expect(tryBeginAutoReload(storage, NOW)).toBe(true)
  })

  test('future stored value (clock skew): blocks', () => {
    const storage = fakeStorage({ [RELOAD_STORAGE_KEY]: String(NOW + 30_000) })
    expect(tryBeginAutoReload(storage, NOW)).toBe(false)
  })

  test('storage that throws on read: blocks (loop safety)', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {},
    }
    expect(tryBeginAutoReload(storage, NOW)).toBe(false)
  })

  test('storage that throws on write: blocks (loop safety)', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(tryBeginAutoReload(storage, NOW)).toBe(false)
  })
})

// ─── maybeStaleChunkReload ───────────────────────────────────────────────────

describe('maybeStaleChunkReload', () => {
  function fakeWindow(init: Record<string, string> = {}) {
    const sessionStorage = fakeStorage(init)
    const reload = vi.fn()
    return { win: { sessionStorage, location: { reload } }, sessionStorage, reload }
  }

  test('stale error, no prior attempt: reloads and records', () => {
    const { win, sessionStorage, reload } = fakeWindow()
    expect(maybeStaleChunkReload(TURBOPACK_CHUNK_ERROR, win, NOW)).toBe('reloading')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.dump()[RELOAD_STORAGE_KEY]).toBe(String(NOW))
  })

  test('stale error, recent attempt: blocked, no reload', () => {
    const { win, reload } = fakeWindow({
      [RELOAD_STORAGE_KEY]: String(NOW - 5_000),
    })
    expect(maybeStaleChunkReload(TURBOPACK_CHUNK_ERROR, win, NOW)).toBe('blocked')
    expect(reload).not.toHaveBeenCalled()
  })

  test('non-stale error: not-stale, storage untouched, no reload', () => {
    const { win, sessionStorage, reload } = fakeWindow()
    expect(
      maybeStaleChunkReload({ name: 'Error', message: 'boom' }, win, NOW)
    ).toBe('not-stale')
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.dump()).toEqual({})
  })

  test('stale error with broken storage: blocked, no reload (loop safety)', () => {
    const reload = vi.fn()
    const win = {
      sessionStorage: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {},
      },
      location: { reload },
    }
    expect(maybeStaleChunkReload(TURBOPACK_CHUNK_ERROR, win, NOW)).toBe('blocked')
    expect(reload).not.toHaveBeenCalled()
  })
})
