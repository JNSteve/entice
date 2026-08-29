import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { AGENT_HELP, agentEnvelopeSchema } from '@/lib/agent-api'
import {
  AgentApiError,
  auditAgentCall,
  authenticateAgentKey,
  executeAgentAction,
} from '@/lib/agent-executor'

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
 * appended to agent_audit. /api/* is outside the auth proxy, so this route
 * enforces its own auth (same pattern as /api/cron/backup).
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

export async function GET(request: Request) {
  const { admin, response } = adminOr503()
  if (!admin) return response
  const key = await authenticateAgentKey(admin, request)
  if (!key) return unauthorized()
  return NextResponse.json({ ok: true, help: AGENT_HELP })
}

export async function POST(request: Request) {
  const startedAt = performance.now()
  const { admin, response } = adminOr503()
  if (!admin) return response

  const key = await authenticateAgentKey(admin, request)
  if (!key) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Body must be JSON: {"action": …}' },
      { status: 400 }
    )
  }

  const parsed = agentEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ')
    const action =
      typeof body === 'object' && body !== null && 'action' in body
        ? String((body as { action: unknown }).action)
        : 'invalid'
    await auditAgentCall(admin, {
      keyId: key.id,
      action,
      target: null,
      envelope: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null,
      rowCount: null,
      ok: false,
      error: detail,
      request,
      startedAt,
    })
    return NextResponse.json({ ok: false, error: detail }, { status: 400 })
  }

  const envelope = parsed.data
  try {
    const { result, rowCount, target } = await executeAgentAction(admin, envelope)
    await auditAgentCall(admin, {
      keyId: key.id,
      action: envelope.action,
      target,
      envelope,
      rowCount,
      ok: true,
      error: null,
      request,
      startedAt,
    })
    return NextResponse.json({ ok: true, action: envelope.action, ...result })
  } catch (err) {
    const status = err instanceof AgentApiError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    await auditAgentCall(admin, {
      keyId: key.id,
      action: envelope.action,
      target: null,
      envelope,
      rowCount: null,
      ok: false,
      error: message,
      request,
      startedAt,
    })
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
