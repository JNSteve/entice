import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'
import { buildInvoicePdfResponse } from '@/pdf/build-invoice-pdf'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Token-gated invoice PDF for the portal billing tab:
 * GET /portal/[token]/invoice-pdf/[id]
 *
 * portal_invoice_file (anon security-definer RPC) proves the link is live
 * WITH billing enabled and that this sent/paid invoice belongs to the
 * client, and logs the download to portal_views. Only then does the
 * service-role client stream the same tax invoice the office produces,
 * watermarked "Issued to {client} via the client portal — {date}".
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params
  if (!UUID_RE.test(id)) return new NextResponse('Not found', { status: 404 })

  const supabase = createPublicClient()
  const [{ data: entitled }, { data: resolved }] = await Promise.all([
    supabase.rpc('portal_invoice_file', { p_token: token, p_id: id }),
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

  return buildInvoicePdfResponse(admin, id, {
    watermark: `Issued to ${branding.client_name} via the client portal — ${fmtDate(todayAU())}`,
  })
}
