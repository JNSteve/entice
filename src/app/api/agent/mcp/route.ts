import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { AGENT_TOOLS } from '@/lib/agent-api'
import { authenticateAgentKey, runAgentRequest } from '@/lib/agent-executor'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Agent API — MCP surface (Streamable HTTP transport, stateless).
 *
 * Exposes the same actions as POST /api/agent as MCP tools, so Claude Code /
 * Cowork sessions can connect natively:
 *
 *   claude mcp add --transport http ecr-portal \
 *     https://entice-pink.vercel.app/api/agent/mcp \
 *     --header "Authorization: Bearer <agent key>"
 *
 * Stateless by design: no session ids, each POST is a full JSON-RPC exchange
 * (initialize / tools/list / tools/call / ping; notifications get 202). GET
 * (SSE streaming) is not offered — 405, which the spec permits. Validation,
 * dispatch and audit go through the shared runAgentRequest pipeline, so this
 * surface can't drift from the REST route.
 */

const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18']
const LATEST_PROTOCOL = '2025-06-18'

type JsonRpcId = string | number | null

function rpcResult(id: JsonRpcId, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200) {
  return NextResponse.json(
    { jsonrpc: '2.0', id, error: { code, message } },
    { status }
  )
}

export async function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}

export async function DELETE() {
  // Stateless server — there is no session to terminate.
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}

export async function POST(request: Request) {
  const startedAt = performance.now()

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return rpcError(null, -32000, 'Agent API unavailable: service role key missing', 503)
  }

  const auth = await authenticateAgentKey(admin, request)
  if (auth.outcome === 'db_error') {
    return rpcError(null, -32000, 'Authentication backend unavailable — try again shortly', 503)
  }
  if (auth.outcome !== 'authenticated') {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid, revoked or missing agent key' } },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
    )
  }
  const key = auth.key

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return rpcError(null, -32700, 'Parse error: body must be JSON')
  }

  if (Array.isArray(body)) {
    return rpcError(null, -32600, 'JSON-RPC batching is not supported')
  }
  if (typeof body !== 'object' || body === null) {
    return rpcError(null, -32600, 'Invalid request')
  }

  const msg = body as { method?: unknown; id?: JsonRpcId; params?: unknown }

  // A message with no id is a notification (client→server) — never answered.
  const isNotification = msg.id === undefined || msg.id === null
  if (typeof msg.method !== 'string') {
    return isNotification
      ? new Response(null, { status: 202 })
      : rpcError(msg.id ?? null, -32600, 'Invalid request: method must be a string')
  }
  if (msg.method.startsWith('notifications/') || isNotification) {
    return new Response(null, { status: 202 })
  }
  const id = msg.id as JsonRpcId
  const params = (msg.params ?? {}) as Record<string, unknown>

  switch (msg.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ecr-portal-agent', version: '1.0.0' },
        instructions:
          'Read/write access to the live ECR (Entice) portal database and storage. ' +
          'Call the help tool first in a fresh session — it documents every tool, ' +
          'the guardrails, and the house rules (production data; test records must ' +
          'be zz-prefixed and cleaned up).',
      })
    }

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, { tools: AGENT_TOOLS })

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      if (!AGENT_TOOLS.some((t) => t.name === name)) {
        return rpcError(id, -32602, `Unknown tool: ${name}`)
      }

      // action LAST so a caller-supplied arguments.action cannot shadow the
      // resolved tool name (which would bypass the allowlist and mis-audit).
      const outcome = await runAgentRequest(
        admin,
        key,
        { ...args, action: name },
        request,
        startedAt
      )
      if (!outcome.ok) {
        return rpcResult(id, {
          content: [{ type: 'text', text: outcome.error }],
          isError: true,
        })
      }
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(outcome.result, null, 2) }],
      })
    }

    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`)
  }
}
