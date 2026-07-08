import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/server'
import { buildComplianceReportResponse } from '@/pdf/build-compliance-report'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'

export const runtime = 'nodejs'

/**
 * Token-gated portfolio compliance report:
 * GET /portal/[token]/report-pdf
 *
 * Resolves the live link (dead tokens → 404), logs the download to
 * portal_views, then streams the same report the office can produce —
 * watermarked "Issued to {client} via the client portal — {date}". Register
 * status + works history only; no money.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const supabase = createPublicClient()
  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as {
    client_id: string
    client_name: string
  } | null
  if (!branding?.client_id) {
    return new NextResponse('Not found', { status: 404 })
  }

  await supabase.rpc('portal_log_view', {
    p_token: token,
    p_site: null,
    p_path: 'file:compliance-report',
  })

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return new NextResponse('Document temporarily unavailable', { status: 503 })
  }

  return buildComplianceReportResponse(admin, branding.client_id, {
    watermark: `Issued to ${branding.client_name} via the client portal — ${fmtDate(todayAU())}`,
  })
}
