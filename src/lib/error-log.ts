// In-app error capture (no external service). Errors land in the
// admin-only `app_errors` register via the SECURITY DEFINER `log_app_error`
// RPC (0027) — the ONLY insert path, granted to anon + authenticated and
// crudely rate-limited in SQL.
//
// reportAppError is fetch-only so the same helper works everywhere errors
// surface: instrumentation.ts onRequestError (Node or Edge runtime) and the
// client error boundaries (src/app/error.tsx, src/app/global-error.tsx).

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

/**
 * Fire a row into app_errors. Never throws and never blocks the caller's
 * error handling — a failure to report is silently dropped.
 */
export async function reportAppError(input: {
  source: 'server' | 'client'
  path?: string | null
  message?: string | null
  stack?: string | null
  userRole?: string | null
}): Promise<void> {
  try {
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
