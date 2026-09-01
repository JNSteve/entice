import { NextResponse } from 'next/server'
import { protectedResourceMetadata } from '@/lib/agent-oauth'
import { requestOrigin } from '@/lib/agent-oauth-server'

export const runtime = 'nodejs'

/**
 * Path-suffixed form of the resource metadata — some MCP clients probe
 * /.well-known/oauth-protected-resource/api/agent/mcp instead of the bare path.
 * Same document either way.
 */
export async function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(requestOrigin(request)), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
