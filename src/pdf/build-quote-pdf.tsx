import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { docTotals } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { QuotePdf, type QuotePdfAcceptance, type QuotePdfSection } from '@/pdf/QuotePdf'
import type { DocCompany } from '@/pdf/DocShell'
import {
  DEFAULT_PRICING,
  buildDetailsRows,
  buildMergeContext,
  mergeDoc,
  pricingDisplaySchema,
  quoteDocSchema,
  type MergeSource,
} from '@/lib/quote-doc'
import { buildPricingModel } from '@/lib/quote-pricing'
import { QuoteDocPdf } from '@/pdf/QuoteDocPdf'

/**
 * Shared quote-PDF builder used by BOTH the office route
 * (/api/pdf/quote/[id], authed client) and the portal proxy
 * (/portal/[token]/approval-pdf, service-role client after the token-gated
 * entitlement check). Fetches everything itself, including the
 * portal-acceptance evidence block (rendered when the quote was accepted via
 * the client portal). Renders the templated QuoteDocPdf when the quote
 * carries a doc snapshot (quotes.doc), otherwise the standard QuotePdf; both
 * honour quotes.pdf_options. Sell side only — costs and markup never appear.
 */
export async function buildQuotePdfResponse(
  supabase: SupabaseClient,
  id: string,
  opts: { watermark?: string | null } = {}
): Promise<Response> {
  const [
    { data: quote },
    { data: sections },
    { data: lines },
    { data: settings },
    { data: acceptanceRow },
  ] = await Promise.all([
    supabase
      .from('quotes')
      .select(
        '*, clients(name, abn, address), sites(name, address, suburb, state, postcode), contacts(name, role, email, phone), profiles!quotes_pm_id_fkey(full_name, phone, position)'
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
      .select('company_name, abn, address, phone, email, logo_path, quote_footer')
      .eq('id', 1)
      .single(),
    supabase
      .from('portal_acceptances')
      .select('signer_name, signature_data, signed_at')
      .eq('kind', 'quote')
      .eq('target_id', id)
      .eq('action', 'accepted')
      .maybeSingle(),
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

  const acceptance: QuotePdfAcceptance | null =
    quote.status === 'accepted' && acceptanceRow
      ? {
          signerName: acceptanceRow.signer_name as string,
          signedAtDisplay: new Date(
            acceptanceRow.signed_at as string
          ).toLocaleString('en-AU', {
            timeZone: 'Australia/Brisbane',
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
          signatureUrl: (acceptanceRow.signature_data as string | null) ?? null,
        }
      : null

  const displayParsed = pricingDisplaySchema.safeParse(quote.pdf_options)
  const display = displayParsed.success ? displayParsed.data : DEFAULT_PRICING
  const docParsed = quote.doc ? quoteDocSchema.safeParse(quote.doc) : null
  const gstRate = Number(quote.gst_rate)
  const quoteFooter = (settings?.quote_footer as string | null) ?? null
  const company = toDocCompany(settings)

  let buffer: Buffer
  if (docParsed?.success) {
    const client = quote.clients as { name: string; abn: string | null; address: string | null } | null
    const contact = quote.contacts as {
      name: string
      role: string | null
      email: string | null
      phone: string | null
    } | null
    const pm = quote.profiles as {
      full_name: string
      phone: string | null
      position: string | null
    } | null
    const src: MergeSource = {
      quote: {
        number: quote.number,
        title: quote.title,
        date: (quote.sent_at ?? quote.created_at) as string,
        valid_days: quote.valid_days,
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
      },
      client,
      contact,
      site: site ? { name: site.name, address: siteAddress } : null,
      pm,
      company: {
        name: company.name,
        abn: company.abn,
        address: company.address,
        phone: company.phone,
        email: company.email,
      },
    }
    const ctx = buildMergeContext(src)
    buffer = await renderToBuffer(
      <QuoteDocPdf
        quote={{
          number: quote.number,
          title: quote.title,
          date: fmtDate(quote.sent_at ?? quote.created_at),
        }}
        company={company}
        doc={mergeDoc(docParsed.data, ctx)}
        details={buildDetailsRows(src, docParsed.data.validity_text)}
        pricing={buildPricingModel(pdfSections, { ...totals, gstRate }, display)}
        quoteFooter={quoteFooter}
        acceptance={acceptance}
        watermark={opts.watermark ?? null}
      />
    )
  } else {
    buffer = await renderToBuffer(
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
        company={company}
        sections={pdfSections}
        totals={{ ...totals, gstRate }}
        validDays={quote.valid_days}
        description={quote.description}
        quoteFooter={quoteFooter}
        acceptance={acceptance}
        watermark={opts.watermark ?? null}
        display={display}
      />
    )
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${quote.number}.pdf"`,
    },
  })
}

export type SettingsRow = {
  company_name: string
  abn: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_path: string | null
}

// react-pdf's <Image> can only decode PNG/JPEG.
const LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg']

/**
 * settings.logo_path may be a bare storage path ("logo.png") or a full public
 * URL. Returns a fetchable URL, or undefined when unset or not a format
 * react-pdf can render. (Mirrors resolveLogoUrl in /api/pdf.)
 */
export function resolveLogo(logoPath: string | null): string | undefined {
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

export function toDocCompany(settings: SettingsRow | null): DocCompany {
  return {
    name: settings?.company_name ?? 'Company',
    abn: settings?.abn,
    address: settings?.address,
    phone: settings?.phone,
    email: settings?.email,
    logoUrl: resolveLogo(settings?.logo_path ?? null),
  }
}
