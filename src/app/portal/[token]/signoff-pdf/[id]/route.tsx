import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'
import { buildSignoffPdfResponse } from '@/pdf/build-signoff-pdf'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Token-gated PDF proxy for daily sign-off sheets:
 * GET /portal/[token]/signoff-pdf/[id]
 *
 * Same shape as approval-pdf:
 * 1. portal_signoff_file (anon security-definer RPC) proves the token is live
 *    AND entitled to this exact released sheet (released, signed, disputed or
 *    superseded — never draft), and logs the download. Anything else → null.
 * 2. Only then does the service-role client build and stream the sheet PDF,
 *    watermarked "Issued to {client} via the client portal — {date}".
 *    Quantities only — no rates or amounts exist in this document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params

  if (!UUID_RE.test(id)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const supabase = createPublicClient()

  const [{ data: entitled }, { data: resolved }] = await Promise.all([
    supabase.rpc('portal_signoff_file', { p_token: token, p_id: id }),
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

  return buildSignoffPdfResponse(admin, id, {
    watermark: `Issued to ${branding.client_name} via the client portal — ${fmtDate(todayAU())}`,
  })
}
