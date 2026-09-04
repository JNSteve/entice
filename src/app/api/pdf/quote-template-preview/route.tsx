import { renderToBuffer } from '@react-pdf/renderer'
import { z } from 'zod'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { docTotals } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'
import {
  buildDetailsRows,
  buildMergeContext,
  mergeDoc,
  parseQuoteDocInput,
  pdfSafeDeep,
  pricingDisplaySchema,
  type MergeSource,
} from '@/lib/quote-doc'
import { buildPricingModel, type PricingSection } from '@/lib/quote-pricing'
import { QuoteDocPdf } from '@/pdf/QuoteDocPdf'
import { toDocCompany } from '@/pdf/build-quote-pdf'

export const runtime = 'nodejs'

const MONEY_ROLES = ['admin', 'office']

const bodySchema = z.object({
  doc: z.unknown(),
  pricing_defaults: z.unknown(),
})

/**
 * POST /api/pdf/quote-template-preview
 *
 * Renders a template draft (unsaved is fine) exactly as a quote would print
 * it, with the real company block from Settings and clearly sample job data,
 * so the editor can show the result without saving and opening a quote.
 * Nothing is stored.
 */
export async function POST(request: Request) {
  const profile = await getProfile()
  if (!profile) return new Response('Unauthorized', { status: 401 })
  if (!MONEY_ROLES.includes(profile.role)) return new Response('Forbidden', { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Expected a JSON body', { status: 400 })
  }
  const parsedBody = bodySchema.safeParse(body)
  if (!parsedBody.success) return new Response('Bad request', { status: 400 })

  const doc = parseQuoteDocInput(parsedBody.data.doc)
  if (!doc.success) {
    return new Response(doc.error.issues[0]?.message ?? 'Invalid document', { status: 422 })
  }
  const display = pricingDisplaySchema.safeParse(parsedBody.data.pricing_defaults)
  if (!display.success) return new Response('Invalid pricing display', { status: 422 })

  const supabase = await createClient()
  const [{ data: settings }, { data: me }] = await Promise.all([
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path, quote_footer, gst_rate')
      .eq('id', 1)
      .single(),
    supabase.from('profiles').select('full_name, phone, position').eq('id', profile.id).single(),
  ])

  const company = pdfSafeDeep(toDocCompany(settings))
  const gstRate = Number(settings?.gst_rate ?? 10)

  const sections: PricingSection[] = [
    {
      title: 'Sample section',
      lines: [
        { description: 'Sample line item one', qty: 2, unit: 'ea', unit_sell: 1500 },
        { description: 'Sample line item two', qty: 12, unit: 'm2', unit_sell: 85 },
      ],
    },
    {
      title: 'Second sample section',
      lines: [{ description: 'Sample line item three', qty: 1, unit: 'ea', unit_sell: 900 }],
    },
  ]
  const totals = docTotals(
    sections.flatMap((s) => s.lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell }))),
    gstRate
  )

  const today = todayAU()
  const src: MergeSource = {
    quote: {
      number: 'RQ26000',
      title: 'Sample job description, 12 Example Street',
      date: today,
      valid_days: 14,
      subtotal: totals.subtotal,
      gst: totals.gst,
      total: totals.total,
    },
    client: { name: 'Sample Client Pty Ltd', abn: '11 222 333 444', address: '12 Example Street, Example QLD 4000' },
    contact: { name: 'Sam Sample', role: 'Project Manager', email: 'sam@example.com', phone: '0400 000 000' },
    site: { name: 'Example Street site', address: '12 Example Street, Example QLD 4000' },
    pm: me
      ? { full_name: me.full_name as string, phone: (me.phone as string | null) ?? null, position: (me.position as string | null) ?? null }
      : null,
    company: {
      name: company.name,
      abn: company.abn,
      address: company.address,
      phone: company.phone,
      email: company.email,
    },
  }
  const ctx = buildMergeContext(src)
  const quoteFooter = (settings?.quote_footer as string | null) ?? null

  const buffer = await renderToBuffer(
    <QuoteDocPdf
      quote={{ number: src.quote.number, title: src.quote.title, date: fmtDate(today) }}
      company={company}
      doc={pdfSafeDeep(mergeDoc(doc.data, ctx))}
      details={pdfSafeDeep(buildDetailsRows(src, doc.data.validity_text))}
      pricing={buildPricingModel(pdfSafeDeep(sections), { ...totals, gstRate }, display.data)}
      quoteFooter={quoteFooter}
      watermark="Template preview with sample data"
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="template-preview.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
