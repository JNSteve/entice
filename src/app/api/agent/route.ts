import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { AGENT_HELP } from '@/lib/agent-api'
import { authenticateAgentKey, runAgentRequest } from '@/lib/agent-executor'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Agent API — REST surface. Lets the owner's Claude sessions (Cowork,
 * claude.ai, Claude Code) read and write portal data remotely:
 *
 *   GET  /api/agent                     → usage doc (auth required)
 *   POST /api/agent {action, ...params} → run one action
 *
 * Auth: `Authorization: Bearer <agent key>` — verified against SHA-256
 * hashes in agent_keys (revocable, last_used_at stamped). Every POST is
 * appended to agent_audit via the shared runAgentRequest pipeline. /api/* is
 * outside the auth proxy, so this route enforces its own auth (same pattern
 * as /api/cron/backup).
 *
 * The MCP surface at /api/agent/mcp exposes the same actions as tools.
 * Design: docs/superpowers/specs/2026-08-29-agent-api-design.md
 */

function adminOr503() {
  try {
    return { admin: createAdminClient(), response: null }
  } catch {
    return {
      admin: null,
      response: NextResponse.json(
        {
          ok: false,
          error:
            'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment — the agent API is unavailable.',
        },
        { status: 503 }
      ),
    }
  }
}

const unauthorized = () =>
  NextResponse.json(
    { ok: false, error: 'Invalid, revoked or missing agent key' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
  )

const authUnavailable = () =>
  NextResponse.json(
    { ok: false, error: 'Authentication backend unavailable — try again shortly' },
    { status: 503 }
  )

export async function GET(request: Request) {
  const { admin, response } = adminOr503()
  if (!admin) return response
  const auth = await authenticateAgentKey(admin, request)
  if (auth.outcome === 'db_error') return authUnavailable()
  if (auth.outcome !== 'authenticated') return unauthorized()
  return NextResponse.json({ ok: true, help: AGENT_HELP })
}

export async function POST(request: Request) {
  const startedAt = performance.now()
  const { admin, response } = adminOr503()
  if (!admin) return response

  const auth = await authenticateAgentKey(admin, request)
  if (auth.outcome === 'db_error') return authUnavailable()
  if (auth.outcome !== 'authenticated') return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Body must be JSON: {"action": …}' },
      { status: 400 }
    )
  }

  const outcome = await runAgentRequest(admin, auth.key, body, request, startedAt)
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status })
  }
  return NextResponse.json({ ok: true, action: outcome.action, ...outcome.result })
}
