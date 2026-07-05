'use client'

// Global error boundary — replaces the ROOT LAYOUT when it fails, so it must
// render its own <html>/<body> and carry its own styling (inline: if the
// layout is down, the app CSS may be too). Branded to match the app
// (#1e3a5f) and reports into the admin-only app_errors register.

import { useEffect } from 'react'
import { reportAppError } from '@/lib/error-log'

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          color: '#0f172a',
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <title>Something went wrong — Entice</title>
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            margin: 24,
            padding: 32,
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
            textAlign: 'center',
          }}
        >
          <div
            aria-hidden
            style={{
              width: 48,
              height: 48,
              margin: '0 auto 16px',
              borderRadius: '50%',
              backgroundColor: '#1e3a5f',
              color: '#ffffff',
              fontSize: 24,
              fontWeight: 600,
              lineHeight: '48px',
            }}
          >
            !
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p
            style={{
              margin: '0 0 16px',
              fontSize: 14,
              lineHeight: 1.5,
              color: '#64748b',
            }}
          >
            The team has been notified. Reload the page, or head back to the
            dashboard — your data is safe.
          </p>
          {error.digest ? (
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#94a3b8' }}>
              Reference: <span style={{ fontFamily: 'monospace' }}>{error.digest}</span>
            </p>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: '#1e3a5f',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            {/* Hard navigation on purpose: when the root layout is down, the
                client router may be too — a full page load is the safe path. */}
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#0f172a',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
