'use client'

// Root error boundary — replaces the unbranded stack/black screen for any
// error thrown below the root layout. Friendly, branded, and reports the
// error into the admin-only app_errors register (Settings → Errors).

import { useEffect } from 'react'
import Link from 'next/link'
import { reportAppError } from '@/lib/error-log'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    reportAppError({
      source: 'client',
      path: typeof window !== 'undefined' ? window.location.pathname : null,
      message: error.message,
      stack: error.stack ?? (error.digest ? `digest: ${error.digest}` : null),
    })
  }, [error])

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
            onClick={() => unstable_retry()}
            className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#162040' }}
          >
            Try again
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
