import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { runDailyDigests } from '@/lib/notify'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Daily notification digests (CP3).
 *
 * GET — Vercel cron (vercel.json, 0 20 * * * UTC = 6 am Brisbane). Vercel
 *       sends `Authorization: Bearer ${CRON_SECRET}` automatically when the
 *       CRON_SECRET env var exists on the project — the same guard as
 *       /api/cron/backup. Anything else is a 401.
 *
 * The run (service role — the cron has no user session):
 *   * per-client compliance digest (items due ≤30 days / overdue), gated by
 *     an active portal link with notifications_enabled, one per Brisbane day
 *     (email_log idempotency — a second run the same day skips);
 *   * a focused office digest (compliance counts, open requests, unread
 *     portal messages, expiring facility licences/permits), only when
 *     something needs attention.
 *
 * With no RESEND_API_KEY configured every send is logged to email_log as
 * 'skipped' — the pipeline is fully observable before sending goes live.
 */

function bearerOk(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!bearerOk(request)) return new Response('Unauthorized', { status: 401 })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      {
        error:
          'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment — the notify digests cannot run until it is added to the environment.',
      },
      { status: 503 }
    )
  }

  try {
    const result = await runDailyDigests(admin)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify] digest run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
