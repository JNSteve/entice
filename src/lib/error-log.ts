// In-app error capture (no external service). Errors land in the
// admin-only `app_errors` register via the SECURITY DEFINER `log_app_error`
// RPC (0027) — the ONLY insert path, granted to anon + authenticated and
// crudely rate-limited in SQL.
//
// reportAppError is fetch-only so the same helper works everywhere errors
// surface: instrumentation.ts onRequestError (Node or Edge runtime) and the
// client error boundaries (src/app/error.tsx, src/app/global-error.tsx).
//
// Local development never reports. .env.local points at the live Supabase
// project, so without the guard every Turbopack hot-reload mid-edit
// ReferenceError would land in Settings → Errors as an open client row
// (six did on 2026-10-23). See isLocalDevelopment.

export const MAX_STACK_CHARS = 4000
export const MAX_MESSAGE_CHARS = 1000
export const MAX_PATH_CHARS = 500

/**
 * Normalise free-form error text for the log: null/empty/whitespace-only
 * collapse to null, everything else is trimmed and hard-capped at `max`
 * characters (the SQL side caps again — this keeps the payload small).
 */
export function trimErrorText(
  text: string | null | undefined,
  max: number
): string | null {
  if (text == null) return null
  const t = text.trim()
  if (t === '') return null
  return t.length <= max ? t : t.slice(0, max)
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Is this runtime a developer's machine rather than a deployment? `next dev`
 * sets NODE_ENV to 'development' on the server and inlines it into the
 * client bundle, which covers both runtimes; the hostname check additionally
 * catches a production build served locally (`next start`), where only the
 * browser knows it is talking to loopback. Server-side callers pass null.
 */
export function isLocalDevelopment(
  nodeEnv: string | undefined,
  hostname: string | null | undefined
): boolean {
  if (nodeEnv === 'development') return true
  if (hostname == null) return false
  // Browsers report an IPv6 loopback as "[::1]".
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')
}

/**
 * Fire a row into app_errors. Never throws and never blocks the caller's
 * error handling — a failure to report is silently dropped. A no-op in
 * local development so the production register only holds deployed errors.
 */
export async function reportAppError(input: {
  source: 'server' | 'client'
  path?: string | null
  message?: string | null
  stack?: string | null
  userRole?: string | null
}): Promise<void> {
  try {
    if (
      isLocalDevelopment(
        process.env.NODE_ENV,
        typeof window !== 'undefined' ? window.location.hostname : null
      )
    ) {
      return
    }
    // NEXT_PUBLIC_* values are inlined into client bundles at build time and
    // available from process.env on the server — safe in both worlds.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return
    await fetch(`${url}/rest/v1/rpc/log_app_error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        p_source: input.source,
        p_path: trimErrorText(input.path, MAX_PATH_CHARS),
        p_message:
          trimErrorText(input.message, MAX_MESSAGE_CHARS) ?? '(no message)',
        p_stack: trimErrorText(input.stack, MAX_STACK_CHARS),
        p_user_role: trimErrorText(input.userRole, 20),
      }),
      // Don't let a client navigation away from the error page cancel the
      // report (browser fetch option; ignored server-side).
      keepalive: true,
    })
  } catch {
    // Error reporting must never introduce errors of its own.
  }
}
