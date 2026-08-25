// Self-healing for stale-deployment chunk errors.
//
// A long-lived tab (or the installed iOS PWA) keeps running the build it
// loaded; after a deploy, that old bundle lazy-loads chunks by hashed names
// the server no longer has, and the load fails (ChunkLoadError). A soft
// retry re-renders inside the same stale bundle and can never succeed — only
// a full page reload fetches fresh HTML pointing at current chunks. The
// error boundaries use these helpers to reload ONCE, with a sessionStorage
// cooldown so a persistent failure (e.g. offline) can't loop.
//
// This is the second layer of skew protection: `deploymentId` in
// next.config.ts hard-navigates stale clients at RSC-fetch time, but lazy
// chunk loads go straight to the CDN with no server round-trip, so failures
// there only surface here.

export const RELOAD_COOLDOWN_MS = 60_000
export const RELOAD_STORAGE_KEY = 'stale-chunk-reload-at'

interface ErrorLike {
  name?: string
  message?: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface WindowLike {
  sessionStorage: StorageLike
  location: { reload(): void }
}

// Chunk/module load failures across bundlers (webpack, turbopack) and the
// browsers' native dynamic-import errors (Chrome / Firefox / Safari). Plain
// network failures ("Failed to fetch") deliberately do NOT match.
const STALE_CHUNK_PATTERNS =
  /failed to load chunk|loading chunk \S+ failed|loading css chunk|dynamically imported module|importing a module script failed/i

/** Is this error a failed chunk/module load — i.e. curable by a reload? */
export function isStaleChunkError(error: ErrorLike): boolean {
  if (error.name === 'ChunkLoadError') return true
  return error.message != null && STALE_CHUNK_PATTERNS.test(error.message)
}

/**
 * Pure read: did an auto-reload run within the cooldown (or is storage
 * unusable, which blocks too — if attempts can't be recorded, reloading
 * risks a loop)? Never writes and never throws, so error UI can call it
 * during render.
 */
export function isReloadBlocked(storage: StorageLike, now: number): boolean {
  try {
    const raw = storage.getItem(RELOAD_STORAGE_KEY)
    const last = raw === null ? null : Number(raw)
    if (last === null || !Number.isFinite(last)) return false
    // A future timestamp (clock weirdness) also blocks: elapsed < cooldown.
    return now - last < RELOAD_COOLDOWN_MS
  } catch {
    return true
  }
}

/**
 * Check-and-record an auto-reload attempt. Returns true when a reload may
 * proceed (none recorded within the cooldown) and records `now`; returns
 * false — never throws — when blocked.
 */
export function tryBeginAutoReload(storage: StorageLike, now: number): boolean {
  if (isReloadBlocked(storage, now)) return false
  try {
    storage.setItem(RELOAD_STORAGE_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/**
 * The full boundary-side decision: if `error` is a stale-chunk error and no
 * reload ran within the cooldown, start a full reload and return 'reloading';
 * 'blocked' means a reload already ran (or storage is unusable) and the
 * boundary should show real error UI; 'not-stale' means this isn't a chunk
 * error at all.
 */
export function maybeStaleChunkReload(
  error: ErrorLike,
  win: WindowLike,
  now: number
): 'reloading' | 'blocked' | 'not-stale' {
  if (!isStaleChunkError(error)) return 'not-stale'
  if (!tryBeginAutoReload(win.sessionStorage, now)) return 'blocked'
  win.location.reload()
  return 'reloading'
}
