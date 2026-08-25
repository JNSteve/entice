'use client'

// Root error boundary — replaces the unbranded stack/black screen for any
// error thrown below the root layout. Friendly, branded, and reports the
// error into the admin-only app_errors register (Settings → Errors).
//
// Stale-deployment chunk errors self-heal instead: one automatic full reload
// (see src/lib/stale-chunk.ts) picks up the current build, so the user never
// sees an error card and the register isn't flooded with rows a reload fixes.
// Only when a reload just ran and the chunk still fails does the card show —
// with a Reload button, because soft retry can't fix a missing chunk.

import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { reportAppError } from '@/lib/error-log'
import {
  isStaleChunkError,
  isReloadBlocked,
  maybeStaleChunkReload,
} from '@/lib/stale-chunk'

// The blocked flag never changes under a mounted boundary (our own write
// coincides with the page reloading), so no store notifications are needed.
const subscribeNever = () => () => {}

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const stale = isStaleChunkError(error)
  // Render-time read of the cooldown guard: true when an auto-reload just
  // ran, so reloading again can't help and real error UI must show.
  const reloadBlocked = useSyncExternalStore(
    subscribeNever,
    () => stale && isReloadBlocked(window.sessionStorage, Date.now()),
    () => false
  )

  useEffect(() => {
    if (stale && maybeStaleChunkReload(error, window, Date.now()) === 'reloading') {
      // The page is about to reload with the current build — healed, not
      // an incident worth a register row.
      return
    }
    reportAppError({
      source: 'client',
      path: typeof window !== 'undefined' ? window.location.pathname : null,
      message: error.message,
      stack: error.stack ?? (error.digest ? `digest: ${error.digest}` : null),
    })
  }, [error, stale])

  if (stale && !reloadBlocked) {
    return (
      <div className="flex min-h-[70vh] flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Getting the latest version…
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[70vh] flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        <div
          className="flex size-12 items-center justify-center rounded-full text-2xl font-semibold text-white"
          style={{ backgroundColor: '#162040' }}
          aria-hidden
        >
          !
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The team has been notified. You can try again, or head back to the
          dashboard — your data is safe.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (stale ? window.location.reload() : unstable_retry())}
            className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#162040' }}
          >
            {stale ? 'Reload page' : 'Try again'}
          </button>
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
