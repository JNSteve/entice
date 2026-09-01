import { NextResponse } from 'next/server'
import { protectedResourceMetadata } from '@/lib/agent-oauth'
import { requestOrigin } from '@/lib/agent-oauth-server'

export const runtime = 'nodejs'

/** RFC 9728 protected resource metadata — public, unauthenticated. */
export async function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(requestOrigin(request)), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
