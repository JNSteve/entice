import { NextResponse } from 'next/server'
import { authorizationServerMetadata } from '@/lib/agent-oauth'
import { requestOrigin } from '@/lib/agent-oauth-server'

export const runtime = 'nodejs'

/**
 * RFC 8414 authorization server metadata — public, unauthenticated.
 * MCP clients fetch this before starting the OAuth flow.
 *
 * NOTE: /.well-known/* is excluded from the auth proxy in src/proxy.ts. Without
 * that it 307s to /login and connector setup fails silently — the same trap the
 * PWA manifest hit (commit 0303edb).
 */
export async function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(requestOrigin(request)), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
