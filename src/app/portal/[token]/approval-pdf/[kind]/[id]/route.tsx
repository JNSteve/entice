import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'
import { buildQuotePdfResponse } from '@/pdf/build-quote-pdf'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Token-gated PDF proxy for portal approvals:
 * GET /portal/[token]/approval-pdf/quote/[id]
 *
 * The office PDF route (/api/pdf) is session-authed, so the portal cannot use
 * it. Instead:
 * 1. portal_approval_file (anon security-definer RPC) proves the token is
 *    live AND entitled to this exact published quote (pending or already
 *    decided), and logs the download to portal_views. Anything else → null.
 * 2. Only then does the service-role client build and stream the SAME
 *    client-facing quote PDF the office produces, watermarked
 *    "Issued to {client} via the client portal — {date}" and carrying the
 *    acceptance block once signed. Sell side only — no costs/margins exist
 *    in this document.
 *
 * Variations have no PDF document office-side either — the portal renders
 * their full detail inline, so only kind 'quote' is served here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; kind: string; id: string }> }
) {
  const { token, kind, id } = await params

  if (kind !== 'quote' || !UUID_RE.test(id)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const supabase = createPublicClient()

  const [{ data: entitled }, { data: resolved }] = await Promise.all([
    supabase.rpc('portal_approval_file', {
      p_token: token,
      p_kind: kind,
      p_id: id,
    }),
    supabase.rpc('portal_resolve_link', { p_token: token }),
  ])
  const branding = (resolved ?? null) as { client_name: string } | null
  if (!entitled || !branding) {
    return new NextResponse('Not found', { status: 404 })
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return new NextResponse('Document temporarily unavailable', { status: 503 })
  }

  return buildQuotePdfResponse(admin, id, {
    watermark: `Issued to ${branding.client_name} via the client portal — ${fmtDate(todayAU())}`,
  })
}
