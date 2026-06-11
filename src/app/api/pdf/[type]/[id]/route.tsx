import { renderToBuffer } from '@react-pdf/renderer'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { QuotePdf, type QuotePdfSection } from '@/pdf/QuotePdf'
import { InvoicePdf } from '@/pdf/InvoicePdf'
import { PoPdf } from '@/pdf/PoPdf'
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
    case 'invoice':
      return invoicePdf(id)
    case 'po':
      return poPdf(id)
    // claim | diary | swms land in later tasks
    default:
      return new Response('Not found', { status: 404 })
  }
}

async function invoicePdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: invoice }, { data: lines }, { data: payments }, { data: settings }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select('*, clients(name), jobs(number, title)')
        .eq('id', id)
        .single(),
      supabase
        .from('invoice_lines')
        .select('position, description, qty, unit, unit_sell')
        .eq('invoice_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('payments')
        .select('date, amount, method, reference')
        .eq('invoice_id', id)
        .order('date')
        .order('id'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path, invoice_footer')
        .eq('id', 1)
        .single(),
    ])

  if (!invoice) return new Response('Not found', { status: 404 })

  const pdfLines = (lines ?? []).map((l) => ({
    description: l.description as string,
    qty: Number(l.qty),
    unit: l.unit as string,
    unit_sell: Number(l.unit_sell),
  }))

  const totals = docTotals(
    pdfLines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })),
    Number(invoice.gst_rate)
  )

  const pdfPayments = (payments ?? []).map((p) => ({
    date: fmtDate(p.date),
    amount: Number(p.amount),
    method: p.method as string | null,
    reference: p.reference as string | null,
  }))
  const paidToDate = round2(pdfPayments.reduce((s, p) => s + p.amount, 0))

  const jobRel = invoice.jobs as { number: string; title: string } | null

  const buffer = await renderToBuffer(
    <InvoicePdf
      invoice={{
        number: invoice.number,
        date: fmtDate(invoice.issue_date),
        dueDate: invoice.due_date ? fmtDate(invoice.due_date) : null,
        clientName: (invoice.clients as { name: string } | null)?.name ?? '—',
        jobNumber: jobRel?.number ?? null,
        jobTitle: jobRel?.title ?? null,
      }}
      company={toCompany(settings)}
      lines={pdfLines}
      totals={{ ...totals, gstRate: Number(invoice.gst_rate) }}
      payments={pdfPayments}
      balanceDue={round2(totals.total - paidToDate)}
      footerText={settings?.invoice_footer ?? null}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
    },
  })
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

async function poPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: po }, { data: poLines }, { data: settings }] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select(
        `id, number, status, issue_date, notes, created_at,
         vendors(name, email, phone),
         projects(name, sites(name, address, suburb, state, postcode))`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('po_lines')
      .select('position, description, qty, unit, unit_cost, cost_codes(code, name)')
      .eq('po_id', id)
      .order('position')
      .order('id'),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path, gst_rate')
      .eq('id', 1)
      .single(),
  ])

  if (!po) return new Response('Not found', { status: 404 })

  const vendorRel = po.vendors as unknown as { name: string; email: string | null; phone: string | null } | null
  const projectRel = po.projects as unknown as {
    name: string
    sites: { name: string; address: string | null; suburb: string | null; state: string | null; postcode: string | null } | null
  } | null

  const site = projectRel?.sites ?? null
  const siteAddress =
    [site?.address, [site?.suburb, site?.state, site?.postcode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ') || null
  const deliverTo = siteAddress ?? (site?.name ? `${site.name}` : null) ?? projectRel?.name ?? '—'

  const pdfLines = (poLines ?? []).map((l) => {
    const codeRel = l.cost_codes as unknown as { code: string; name: string } | null
    return {
      description: l.description as string,
      cost_code: codeRel ? `${codeRel.code}` : null,
      qty: Number(l.qty),
      unit: l.unit as string,
      unit_cost: Number(l.unit_cost),
    }
  })

  const subtotal = round2(pdfLines.reduce((s, l) => s + lineTotal(l.qty, l.unit_cost), 0))
  const gstRate = Number(settings?.gst_rate ?? 10)
  const gst = round2(subtotal * gstRate / 100)
  const total = round2(subtotal + gst)

  const docDate = po.issue_date
    ? fmtDate(po.issue_date)
    : fmtDate(po.created_at)

  const buffer = await renderToBuffer(
    <PoPdf
      po={{
        number: po.number,
        date: docDate,
        vendorName: vendorRel?.name ?? '—',
        vendorEmail: vendorRel?.email,
        vendorPhone: vendorRel?.phone,
        deliverTo,
        notes: po.notes,
        status: po.status,
      }}
      company={toCompany(settings)}
      lines={pdfLines}
      totals={{ subtotal, gst, gstRate, total }}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${po.number}.pdf"`,
    },
  })
}
