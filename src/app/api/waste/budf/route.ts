import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { buildBudfFile, type BudfMovement } from '@/lib/waste/budf'

// Statutory export — never cached, always resolved fresh.
export const dynamic = 'force-dynamic'

/**
 * GET /api/waste/budf?month=YYYY-MM → the monthly bulk upload data file.
 *
 * The month selects movements by DISPOSAL date (spec §2.4: "records for all
 * trackable waste movements where the waste was disposed of within the
 * calendar month that the file is required for"), NOT collection date. The
 * YYYYMMDD in the filename is separately the date the file was generated
 * (§2.4.1).
 *
 * Returns 409 with a JSON list of problems rather than a partial file: "A bulk
 * upload data file received by the department which does not conform to this
 * specification will not be accepted" (§1) — it is rejected in full, so a
 * partial file is worse than none.
 */
export async function GET(request: Request) {
  await requireRole('admin', 'office', 'supervisor')

  const month = new URL(request.url).searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return Response.json(
      { error: 'Pass a month as ?month=YYYY-MM' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  const { data: settings } = await supabase
    .from('settings')
    .select('company_name, budf_identifier, budf_approved_at')
    .eq('id', 1)
    .single()

  // Disposal month → an inclusive start and an exclusive end.
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('regulated_waste_movements')
    .select('*')
    .gte('received_date', start)
    .lt('received_date', end)
    .order('load_seq')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const movements = (data ?? []) as unknown as BudfMovement[]

  const result = buildBudfFile({
    movements,
    identifier: settings?.budf_identifier as string | null,
    companyName: settings?.company_name as string | null,
    generatedOn: todayAU(),
  })

  if (!result.ok) {
    return Response.json(
      {
        month,
        error:
          'This file was not produced. The department rejects a non-conforming file in full, so nothing is emitted until every record is complete.',
        problems: result.problems,
      },
      { status: 409 }
    )
  }

  const headers: HeadersInit = {
    'Content-Type': 'text/csv; charset=us-ascii',
    'Content-Disposition': `attachment; filename="${result.fileName}"`,
    'Cache-Control': 'no-store',
    'X-Budf-Record-Count': String(result.recordCount),
  }
  // The header row is a placeholder until the department's own template is
  // available (§2.4.2) — say so in a way a script can see, not just a human.
  if (result.headerIsPlaceholder) {
    headers['X-Budf-Header-Placeholder'] = 'true'
  }
  if (!settings?.budf_approved_at) {
    headers['X-Budf-Unapproved'] = 'true'
  }

  return new Response(result.csv, { headers })
}
