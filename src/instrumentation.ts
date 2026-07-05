// Server-side error capture (Next.js instrumentation file convention).
// onRequestError fires whenever the Next.js server captures an error in a
// render, route handler, server action or the proxy — each one lands in the
// admin-only app_errors register (Settings → Errors) via log_app_error.
// reportAppError is fetch-only, so this works in both Node and Edge runtimes,
// and it never throws.

import type { Instrumentation } from 'next'
import { reportAppError } from '@/lib/error-log'

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  const e =
    err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err))
  await reportAppError({
    source: 'server',
    path: request.path,
    message: `[${context.routeType}] ${e.message}`,
    stack: e.stack,
  })
}
