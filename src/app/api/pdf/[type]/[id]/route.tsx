import { renderToBuffer } from '@react-pdf/renderer'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { docTotals } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { QuotePdf, type QuotePdfSection } from '@/pdf/QuotePdf'
import type { DocCompany } from '@/pdf/DocShell'

export const runtime = 'nodejs'

// PDFs are money documents — office/admin only. /api/* is excluded from the
// auth proxy, so this route enforces auth itself.
const ALLOWED_ROLES = ['admin', 'office']

// react-pdf's <Image> can only decode PNG/JPEG.
const LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg']

type SettingsRow = {
  company_name: string
  abn: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_path: string | null
}

/**
 * settings.logo_path may be a bare storage path ("logo.png") or a full public
 * URL (the settings form stores `getPublicUrl(...)?v=...`). Returns a fetchable
 * URL, or undefined when unset or not a format react-pdf can render.
 */
function resolveLogoUrl(logoPath: string | null): string | undefined {
  if (!logoPath) return undefined
  const url = logoPath.startsWith('http')
    ? logoPath
    : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${logoPath}`
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    return LOGO_EXTENSIONS.includes(ext) ? url : undefined
  } catch {
    return undefined
  }
}

function toCompany(settings: SettingsRow | null): DocCompany {
  return {
    name: settings?.company_name ?? 'Company',
    abn: settings?.abn,
    address: settings?.address,
    phone: settings?.phone,
    email: settings?.email,
    logoUrl: resolveLogoUrl(settings?.logo_path ?? null),
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const profile = await getProfile()
  if (!profile) return new Response('Unauthorized', { status: 401 })
  if (!ALLOWED_ROLES.includes(profile.role)) {
    return new Response('Forbidden', { status: 403 })
  }

  const { type, id } = await params

  switch (type) {
    case 'quote':
      return quotePdf(id)
    // invoice | claim | po | diary | swms land in later tasks
    default:
      return new Response('Not found', { status: 404 })
  }
}

async function quotePdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: quote }, { data: sections }, { data: lines }, { data: settings }] =
    await Promise.all([
      supabase
        .from('quotes')
        .select(
          '*, clients(name), sites(name, address, suburb, state, postcode), contacts(name)'
        )
        .eq('id', id)
        .single(),
      supabase
        .from('quote_sections')
        .select('id, title, position')
        .eq('quote_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('quote_lines')
        .select('section_id, position, description, qty, unit, unit_sell')
        .eq('quote_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!quote) return new Response('Not found', { status: 404 })

  const allLines = (lines ?? []).map((l) => ({
    section_id: l.section_id as string | null,
    description: l.description as string,
    qty: Number(l.qty),
    unit: l.unit as string,
    unit_sell: Number(l.unit_sell),
  }))

  const pdfSections: QuotePdfSection[] = (sections ?? [])
    .map((s) => ({
      title: s.title as string,
      lines: allLines.filter((l) => l.section_id === s.id),
    }))
    .filter((s) => s.lines.length > 0)

  // Lines orphaned by a deleted section (FK is on delete set null).
  const orphanLines = allLines.filter(
    (l) => !l.section_id || !(sections ?? []).some((s) => s.id === l.section_id)
  )
  if (orphanLines.length > 0) {
    pdfSections.push({ title: 'Items', lines: orphanLines })
  }

  const totals = docTotals(
    allLines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })),
    Number(quote.gst_rate)
  )

  const site = quote.sites as {
    name: string
    address: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
  } | null
  const siteAddress =
    [site?.address, [site?.suburb, site?.state, site?.postcode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ') || null

  const buffer = await renderToBuffer(
    <QuotePdf
      quote={{
        number: quote.number,
        title: quote.title,
        date: fmtDate(quote.sent_at ?? quote.created_at),
        clientName: (quote.clients as { name: string } | null)?.name ?? '—',
        contactName: (quote.contacts as { name: string } | null)?.name ?? null,
        siteName: site?.name ?? null,
        siteAddress,
      }}
      company={toCompany(settings)}
      sections={pdfSections}
      totals={{ ...totals, gstRate: Number(quote.gst_rate) }}
      validDays={quote.valid_days}
      description={quote.description}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${quote.number}.pdf"`,
    },
  })
}
