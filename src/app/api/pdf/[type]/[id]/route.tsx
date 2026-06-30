import { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { format, parseISO } from 'date-fns'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeClaim, type ClaimLineInput } from '@/lib/claims'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { QuotePdf, type QuotePdfSection } from '@/pdf/QuotePdf'
import { InvoicePdf } from '@/pdf/InvoicePdf'
import { PoPdf } from '@/pdf/PoPdf'
import { ClaimPdf, type ClaimPdfLine } from '@/pdf/ClaimPdf'
import { DiaryPdf, type DiaryPdfDay, type DiaryPdfPhoto } from '@/pdf/DiaryPdf'
import { SwmsPdf, type SwmsPdfSignature } from '@/pdf/SwmsPdf'
import { ProgrammePdf, type ProgrammePdfHoldPoint } from '@/pdf/ProgrammePdf'
import { FormPdf, type FormPdfSignon } from '@/pdf/FormPdf'
import { IncidentPdf, type IncidentPdfAction } from '@/pdf/IncidentPdf'
import { NcrPdf, type NcrPdfAction } from '@/pdf/NcrPdf'
import { QrPosterPdf } from '@/pdf/QrPosterPdf'
import { DocumentRegisterPdf, type DocumentRegisterPdfRow } from '@/pdf/DocumentRegisterPdf'
import { DOC_CATEGORY_LABELS, DOC_SYSTEM_LABELS, type DocCategory, type DocSystem } from '@/lib/zod'
import { todayAU } from '@/lib/tz'
import type { SwmsHazard, FormField, FormTemplateKind } from '@/lib/zod'
import type { DocCompany } from '@/pdf/DocShell'

export const runtime = 'nodejs'

// /api/* is excluded from the auth proxy, so this route enforces auth itself.
// Money documents are office/admin only; site diaries, SWMS and the project
// programme are operational, so supervisors may export them too (field cannot).
const MONEY_ROLES = ['admin', 'office']
const OPS_ROLES = ['admin', 'office', 'supervisor']

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
  request: Request,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const profile = await getProfile()
  if (!profile) return new Response('Unauthorized', { status: 401 })

  const { type, id } = await params

  const allowedRoles =
    type.startsWith('diary') || type === 'swms' || type === 'programme' || type === 'form' || type === 'incident' || type === 'ncr' || type === 'qr-poster' || type === 'document-register'
      ? OPS_ROLES
      : MONEY_ROLES
  if (!allowedRoles.includes(profile.role)) {
    return new Response('Forbidden', { status: 403 })
  }

  switch (type) {
    case 'quote':
      return quotePdf(id)
    case 'invoice':
      return invoicePdf(id)
    case 'po':
      return poPdf(id)
    case 'claim':
      return claimPdf(id)
    case 'diary':
      // [id] = diary row id → single-day export
      return diaryPdf(id)
    case 'diary-range': {
      // [id] = project id; ?from=YYYY-MM-DD&to=YYYY-MM-DD → multi-day export
      const url = new URL(request.url)
      return diaryRangePdf(id, url.searchParams.get('from'), url.searchParams.get('to'))
    }
    case 'swms':
      return swmsPdf(id)
    case 'programme':
      // [id] = project id
      return programmePdf(id)
    case 'form':
      return formPdf(id)
    case 'incident':
      return incidentPdf(id)
    case 'ncr':
      return ncrPdf(id)
    case 'qr-poster':
      // [id] = share_links row id
      return qrPosterPdf(id, request)
    case 'document-register':
      // [id] is a placeholder (use 'list') — the register PDF covers all docs.
      return documentRegisterPdf()
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

async function claimPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: claim }, { data: claimLines }, { data: settings }] = await Promise.all([
    supabase
      .from('claims')
      .select(
        `id, project_id, number, status, reference_date, gst_rate,
         gross_this_claim, retention_this_claim, subtotal, gst, total_inc_gst,
         projects(name, number, client_ref, superintendent, contract_sum,
                  retention_pct, retention_cap_pct, clients(name, abn))`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('claim_lines')
      .select(
        'source_type, source_id, description, line_value, pct_complete, previous_claimed, claimed_to_date, this_claim'
      )
      .eq('claim_id', id),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path, claim_footer')
      .eq('id', 1)
      .single(),
  ])

  if (!claim) return new Response('Not found', { status: 404 })

  const projectRel = claim.projects as unknown as {
    name: string
    number: string
    client_ref: string | null
    superintendent: string | null
    contract_sum: number
    retention_pct: number
    retention_cap_pct: number
    clients: { name: string; abn: string | null } | null
  } | null
  if (!projectRel) return new Response('Not found', { status: 404 })

  const [{ data: budgetLines }, { data: variations }, { data: retentionEntries }] =
    await Promise.all([
      supabase
        .from('budget_lines')
        .select('id, position')
        .eq('project_id', claim.project_id)
        .order('position'),
      supabase
        .from('variations')
        .select('id, number, sell_amount, status')
        .eq('project_id', claim.project_id),
      supabase
        .from('retention_entries')
        .select('kind, amount, claim_id, claims(number)')
        .eq('project_id', claim.project_id),
    ])

  // Deterministic ordering matching the editor.
  const budgetPos = new Map((budgetLines ?? []).map((b, i) => [b.id as string, i]))
  const voNum = new Map((variations ?? []).map((v) => [v.id as string, v.number as number]))
  const orderKey = (l: { source_type: string; source_id: string }) =>
    l.source_type === 'budget_line'
      ? (budgetPos.get(l.source_id) ?? Number.MAX_SAFE_INTEGER)
      : (voNum.get(l.source_id) ?? Number.MAX_SAFE_INTEGER)

  const sorted = (claimLines ?? [])
    .map((l) => ({
      source_type: l.source_type as string,
      source_id: l.source_id as string,
      description: l.description as string,
      line_value: Number(l.line_value),
      pct_complete: Number(l.pct_complete),
      previous_claimed: Number(l.previous_claimed),
      claimed_to_date: Number(l.claimed_to_date),
      this_claim: Number(l.this_claim),
    }))
    .sort(
      (a, b) =>
        orderKey(a) - orderKey(b) || a.description.localeCompare(b.description)
    )

  const toPdfLine = (l: (typeof sorted)[number]): ClaimPdfLine => ({
    description: l.description,
    line_value: l.line_value,
    pct_complete: l.pct_complete,
    claimed_to_date: l.claimed_to_date,
    previous_claimed: l.previous_claimed,
    this_claim: l.this_claim,
  })
  const contractLines = sorted.filter((l) => l.source_type === 'budget_line').map(toPdfLine)
  const variationLines = sorted.filter((l) => l.source_type === 'variation').map(toPdfLine)

  // Retention held up to and including this claim (later claims excluded).
  const heldToDateBase = round2(
    (retentionEntries ?? []).reduce((s, e) => {
      const entryClaimNumber =
        (e.claims as unknown as { number: number } | null)?.number ?? null
      if (entryClaimNumber != null && entryClaimNumber > claim.number) return s
      return s + (e.kind === 'withheld' ? Number(e.amount) : -Number(e.amount))
    }, 0)
  )

  const gstRate = Number(claim.gst_rate)
  let totals: {
    gross: number
    retention: number
    retentionHeldToDate: number
    subtotal: number
    gst: number
    gstRate: number
    total: number
  }

  if (claim.status !== 'draft' && claim.subtotal != null) {
    totals = {
      gross: Number(claim.gross_this_claim ?? 0),
      retention: Number(claim.retention_this_claim ?? 0),
      retentionHeldToDate: heldToDateBase,
      subtotal: Number(claim.subtotal),
      gst: Number(claim.gst ?? 0),
      gstRate,
      total: Number(claim.total_inc_gst ?? 0),
    }
  } else {
    // Draft: recompute via the engine against the adjusted contract sum.
    const adjustedSum = round2(
      Number(projectRel.contract_sum) +
        (variations ?? [])
          .filter((v) => v.status === 'approved')
          .reduce((s, v) => s + Number(v.sell_amount), 0)
    )
    const inputs: ClaimLineInput[] = sorted.map((l) => ({
      sourceType: l.source_type as 'budget_line' | 'variation',
      sourceId: l.source_id,
      description: l.description,
      lineValue: l.line_value,
      pctComplete: l.pct_complete,
      previousClaimed: l.previous_claimed,
    }))
    const result = computeClaim(
      inputs,
      {
        pctPerClaim: Number(projectRel.retention_pct),
        capPct: Number(projectRel.retention_cap_pct),
        contractSum: adjustedSum,
        previouslyWithheld: heldToDateBase,
      },
      gstRate
    )
    totals = {
      gross: result.grossThisClaim,
      retention: result.retentionThisClaim,
      retentionHeldToDate: round2(heldToDateBase + result.retentionThisClaim),
      subtotal: result.subtotal,
      gst: result.gst,
      gstRate,
      total: result.totalIncGst,
    }
  }

  const buffer = await renderToBuffer(
    <ClaimPdf
      claim={{
        number: claim.number,
        date: fmtDate(claim.reference_date),
        status: claim.status,
        projectName: projectRel.name,
        projectNumber: projectRel.number,
        clientName: projectRel.clients?.name ?? '—',
        clientAbn: projectRel.clients?.abn,
        clientRef: projectRel.client_ref,
        superintendent: projectRel.superintendent,
      }}
      company={toCompany(settings)}
      contractLines={contractLines}
      variationLines={variationLines}
      totals={totals}
      footerText={settings?.claim_footer ?? null}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="payment-claim-${claim.number}.pdf"`,
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

// ─── Site diary ──────────────────────────────────────────────────────────────

type DiaryRouteRow = {
  id: string
  date: string
  weather: string | null
  work_performed: string | null
  delays: string | null
  instructions: string | null
  visitors: string | null
  profiles: { full_name: string } | null
}

const DIARY_SELECT = `id, date, weather, work_performed, delays, instructions, visitors,
  profiles!diaries_created_by_fkey(full_name)`

// react-pdf's <Image> can only decode PNG/JPEG.
const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png']

/**
 * Shapes diary rows into DiaryPdf day props: child labour/plant rows plus a
 * photo contact sheet built from signed attachment URLs (fetched server-side).
 */
async function buildDiaryDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  diaries: DiaryRouteRow[]
): Promise<DiaryPdfDay[]> {
  const diaryIds = diaries.map((d) => d.id)

  const [{ data: labourRows }, { data: plantRows }, { data: photoRows }] =
    await Promise.all([
      supabase
        .from('diary_labour')
        .select('diary_id, name, trade, headcount, hours')
        .in('diary_id', diaryIds)
        .order('id'),
      supabase
        .from('diary_plant')
        .select('diary_id, name, status, hours')
        .in('diary_id', diaryIds)
        .order('id'),
      supabase
        .from('attachments')
        .select('parent_id, path, caption, content_type, created_at')
        .eq('parent_type', 'diary')
        .in('parent_id', diaryIds)
        .eq('kind', 'photo')
        .order('created_at'),
    ])

  const photos = (photoRows ?? []).filter((p) =>
    PHOTO_CONTENT_TYPES.includes(p.content_type as string)
  )

  // Batch-sign all photo URLs — react-pdf fetches them over https at render time.
  const urlByPath = new Map<string, string>()
  if (photos.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(photos.map((p) => p.path as string), 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  return diaries.map((d) => {
    const dayPhotos: DiaryPdfPhoto[] = photos
      .filter((p) => p.parent_id === d.id && urlByPath.has(p.path as string))
      .map((p) => ({
        url: urlByPath.get(p.path as string)!,
        caption: (p.caption as string | null) ?? null,
        timestamp: format(parseISO(p.created_at as string), 'dd/MM/yyyy HH:mm'),
      }))

    return {
      date: format(parseISO(d.date), 'EEEE dd/MM/yyyy'),
      weather: d.weather,
      author: d.profiles?.full_name ?? null,
      work_performed: d.work_performed,
      delays: d.delays,
      instructions: d.instructions,
      visitors: d.visitors,
      labour: (labourRows ?? [])
        .filter((l) => l.diary_id === d.id)
        .map((l) => ({
          name: l.name as string,
          trade: (l.trade as string | null) ?? null,
          headcount: Number(l.headcount),
          hours: Number(l.hours),
        })),
      plant: (plantRows ?? [])
        .filter((p) => p.diary_id === d.id)
        .map((p) => ({
          name: p.name as string,
          status: p.status as string,
          hours: Number(p.hours),
        })),
      photos: dayPhotos,
    }
  })
}

async function diaryPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: diary }, { data: settings }] = await Promise.all([
    supabase
      .from('diaries')
      .select(`${DIARY_SELECT}, project_id, projects(name, number)`)
      .eq('id', id)
      .single(),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  if (!diary) return new Response('Not found', { status: 404 })

  const projectRel = diary.projects as unknown as { name: string; number: string } | null
  if (!projectRel) return new Response('Not found', { status: 404 })

  const days = await buildDiaryDays(supabase, [
    diary as unknown as DiaryRouteRow,
  ])

  const buffer = await renderToBuffer(
    <DiaryPdf
      project={{ name: projectRel.name, number: projectRel.number }}
      company={toCompany(settings)}
      days={days}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="diary-${projectRel.number}-${diary.date}.pdf"`,
    },
  })
}

// ─── SWMS ────────────────────────────────────────────────────────────────────

async function swmsPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: instance }, { data: signatures }, { data: settings }] =
    await Promise.all([
      supabase
        .from('swms_instances')
        .select(
          `id, title, body, hazards, version, status, created_at,
           projects(number, name), jobs(number, title)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('swms_signatures')
        .select('name, company, external, signature_path, signature_data, version, signed_at')
        .eq('swms_instance_id', id)
        .order('signed_at'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!instance) return new Response('Not found', { status: 404 })

  const projectRel = instance.projects as unknown as {
    number: string
    name: string
  } | null
  const jobRel = instance.jobs as unknown as { number: string; title: string } | null
  const parentLabel = projectRel
    ? `${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `${jobRel.number} — ${jobRel.title}`
      : '—'

  const currentVersion = Number(instance.version)
  const currentSigs = (signatures ?? []).filter(
    (s) => Number(s.version) === currentVersion
  )
  const earlierSignatureCount = (signatures ?? []).length - currentSigs.length

  // Batch-sign signature image URLs — react-pdf fetches them at render time.
  // Missing objects (e.g. seeded rows) simply render without an image.
  // External rows store the PNG inline (signature_data) instead of a path.
  const pathSigs = currentSigs.filter((s) => s.signature_path)
  const urlByPath = new Map<string, string>()
  if (pathSigs.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(pathSigs.map((s) => s.signature_path as string), 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const pdfSignatures: SwmsPdfSignature[] = currentSigs.map((s) => {
    const company = s.company as string | null
    const external = Boolean(s.external)
    return {
      name: external
        ? `${s.name as string} (External${company ? ` — ${company}` : ''})`
        : (s.name as string),
      date: fmtDate(s.signed_at),
      version: Number(s.version),
      imageUrl: s.signature_path
        ? (urlByPath.get(s.signature_path as string) ?? null)
        : ((s.signature_data as string | null) ?? null),
    }
  })

  const buffer = await renderToBuffer(
    <SwmsPdf
      swms={{
        title: instance.title,
        parentLabel,
        version: currentVersion,
        status: instance.status,
        date: fmtDate(instance.created_at),
      }}
      company={toCompany(settings)}
      body={instance.body ?? null}
      hazards={((instance.hazards as SwmsHazard[] | null) ?? []).map((h) => ({
        task: h.task,
        hazards: h.hazards,
        risk: h.risk,
        controls: h.controls,
        residual_risk: h.residual_risk,
      }))}
      signatures={pdfSignatures}
      earlierSignatureCount={earlierSignatureCount}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="swms-v${currentVersion}.pdf"`,
    },
  })
}

// ─── Programme ───────────────────────────────────────────────────────────────

async function programmePdf(projectId: string): Promise<Response> {
  const supabase = await createClient()

  const [
    { data: project },
    { data: tasks },
    { data: links },
    { data: holdPoints },
    { data: settings },
  ] = await Promise.all([
    supabase.from('projects').select('name, number').eq('id', projectId).single(),
    supabase
      .from('programme_tasks')
      .select(
        'id, name, phase, start_date, end_date, progress_pct, baseline_start, baseline_end'
      )
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('programme_links')
      .select('predecessor_id, successor_id')
      .eq('project_id', projectId),
    supabase
      .from('hold_points')
      .select('task_id, title, date, status')
      .eq('project_id', projectId)
      .order('date'),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  if (!project) return new Response('Not found', { status: 404 })
  if (!tasks || tasks.length === 0) {
    return new Response('No programme tasks for this project', { status: 404 })
  }

  const pdfTasks = tasks.map((t) => ({
    id: t.id as string,
    name: t.name as string,
    phase: (t.phase as string | null) ?? null,
    start: t.start_date as string,
    end: t.end_date as string,
    progressPct: Number(t.progress_pct),
    baselineStart: (t.baseline_start as string | null) ?? null,
    baselineEnd: (t.baseline_end as string | null) ?? null,
  }))

  const buffer = await renderToBuffer(
    <ProgrammePdf
      project={{ name: project.name, number: project.number }}
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      baselineSet={pdfTasks.some((t) => t.baselineStart && t.baselineEnd)}
      tasks={pdfTasks}
      links={(links ?? []).map((l) => ({
        predecessorId: l.predecessor_id as string,
        successorId: l.successor_id as string,
      }))}
      holdPoints={(holdPoints ?? []).map((hp) => ({
        taskId: hp.task_id as string,
        title: hp.title as string,
        date: hp.date as string,
        status: hp.status as ProgrammePdfHoldPoint['status'],
      }))}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="programme-${project.number}.pdf"`,
    },
  })
}

async function diaryRangePdf(
  projectId: string,
  from: string | null,
  to: string | null
): Promise<Response> {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!from || !to || !dateRe.test(from) || !dateRe.test(to) || from > to) {
    return new Response('Invalid date range — expected ?from=YYYY-MM-DD&to=YYYY-MM-DD', {
      status: 400,
    })
  }

  const supabase = await createClient()

  const [{ data: project }, { data: diaries }, { data: settings }] = await Promise.all([
    supabase.from('projects').select('name, number').eq('id', projectId).single(),
    supabase
      .from('diaries')
      .select(DIARY_SELECT)
      .eq('project_id', projectId)
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  if (!project) return new Response('Not found', { status: 404 })
  if (!diaries || diaries.length === 0) {
    return new Response('No diary entries in that date range', { status: 404 })
  }

  const days = await buildDiaryDays(supabase, diaries as unknown as DiaryRouteRow[])

  const buffer = await renderToBuffer(
    <DiaryPdf
      project={{ name: project.name, number: project.number }}
      company={toCompany(settings)}
      days={days}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="diary-${project.number}-${from}-to-${to}.pdf"`,
    },
  })
}

// ─── Form submission ──────────────────────────────────────────────────────────

async function formPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: submission }, { data: settings }] = await Promise.all([
    supabase
      .from('form_submissions')
      .select(
        `id, kind, template_id, template_version, submitted_at, data,
         projects(number, name),
         jobs(number, title),
         plant(name),
         profiles!form_submissions_submitted_by_fkey(full_name),
         form_templates(name, schema)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  if (!submission) return new Response('Not found', { status: 404 })

  const projectRel = submission.projects as unknown as { number: string; name: string } | null
  const jobRel = submission.jobs as unknown as { number: string; title: string } | null
  const plantRel = submission.plant as unknown as { name: string } | null
  const profileRel = submission.profiles as unknown as { full_name: string } | null
  const templateRel = submission.form_templates as unknown as { name: string; schema: FormField[] } | null

  const target = projectRel
    ? `${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `${jobRel.number} — ${jobRel.title}`
      : null

  // Fetch signons and attachment count
  const [{ data: signons }, { count: attachmentCount }] = await Promise.all([
    supabase
      .from('form_signons')
      .select('name, company, profile_id, signed_at, signature_path, signature_data')
      .eq('submission_id', id)
      .order('signed_at'),
    supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      .eq('parent_type', 'form_submission')
      .eq('parent_id', id),
  ])

  // Sign signature_path URLs (stored signatures)
  const urlByPath = new Map<string, string>()
  const pathSignons = (signons ?? []).filter((s) => s.signature_path)
  if (pathSignons.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(pathSignons.map((s) => s.signature_path as string), 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const pdfSignons: FormPdfSignon[] = (signons ?? []).map((s) => ({
    name: s.name as string,
    company: (s.company as string | null) ?? null,
    internal: s.profile_id !== null,
    signedAt: format(parseISO(s.signed_at as string), 'dd/MM/yyyy HH:mm'),
    imageUrl: s.signature_path
      ? (urlByPath.get(s.signature_path as string) ?? null)
      : (s.signature_data as string | null) ?? null,
  }))

  const schema = (templateRel?.schema ?? []) as FormField[]

  const buffer = await renderToBuffer(
    <FormPdf
      submission={{
        templateName: templateRel?.name ?? 'WHS Form',
        kind: submission.kind as FormTemplateKind,
        templateVersion: submission.template_version,
        submittedAt: submission.submitted_at as string,
        submittedBy: profileRel?.full_name ?? '—',
        target,
        plant: plantRel?.name ?? null,
        attachmentCount: attachmentCount ?? 0,
      }}
      company={toCompany(settings)}
      schema={schema}
      data={(submission.data ?? {}) as Record<string, unknown>}
      signons={pdfSignons}
    />
  )

  const dateSlug = (submission.submitted_at as string).slice(0, 10)
  const kindSlug = submission.kind as string

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="form-${kindSlug}-${dateSlug}.pdf"`,
    },
  })
}

// ─── Incident ─────────────────────────────────────────────────────────────────

async function incidentPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: incident }, { data: actions }, { data: photoCount }, { data: settings }] =
    await Promise.all([
      supabase
        .from('incidents')
        .select(
          `id, number, type, severity, occurred_at, location, description,
           immediate_action, reported_by, status, closed_at, project_id, job_id,
           projects(number, name), jobs(number, title)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('corrective_actions')
        .select(
          'description, assigned_to, due_date, status, completed_at'
        )
        .eq('incident_id', id)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at'),
      supabase
        .from('attachments')
        .select('id', { count: 'exact', head: true })
        .eq('parent_type', 'incident')
        .eq('parent_id', id)
        .eq('kind', 'photo'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!incident) return new Response('Not found', { status: 404 })

  const projectRel = incident.projects as unknown as { number: string; name: string } | null
  const jobRel = incident.jobs as unknown as { number: string; title: string } | null
  const projectLabel = projectRel
    ? `${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `${jobRel.number} — ${jobRel.title}`
      : null

  const { INCIDENT_TYPE_LABELS } = await import('@/lib/zod')

  const pdfActions: IncidentPdfAction[] = (actions ?? []).map((a) => ({
    description: a.description as string,
    assigned_to: (a.assigned_to as string | null) ?? null,
    due_date: (a.due_date as string | null) ?? null,
    status: a.status as string,
    completed_at: (a.completed_at as string | null) ?? null,
  }))

  const incidentType = incident.type as keyof typeof INCIDENT_TYPE_LABELS
  const occurredDate = incident.occurred_at
    ? format(parseISO(incident.occurred_at as string), 'dd/MM/yyyy HH:mm')
    : '—'

  const buffer = await renderToBuffer(
    <IncidentPdf
      incident={{
        number: incident.number as string,
        date: occurredDate,
        type: INCIDENT_TYPE_LABELS[incidentType] ?? (incident.type as string),
        severity: Number(incident.severity),
        status: incident.status as string,
        occurred: occurredDate,
        location: (incident.location as string | null) ?? null,
        project: projectLabel,
        reportedBy: (incident.reported_by as string | null) ?? null,
        closedAt: incident.closed_at ? fmtDate(incident.closed_at) : null,
        description: incident.description as string,
        immediateAction: (incident.immediate_action as string | null) ?? null,
        photoCount: (photoCount as unknown as number) ?? 0,
      }}
      company={toCompany(settings)}
      actions={pdfActions}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${incident.number as string}.pdf"`,
    },
  })
}

// ─── NCR (nonconformance) ─────────────────────────────────────────────────────

async function ncrPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: ncr }, { data: actions }, { data: photoCount }, { data: settings }] =
    await Promise.all([
      supabase
        .from('ncrs')
        .select(
          `id, number, source, category, severity, title, description,
           immediate_action, root_cause, status, occurred_on, created_at,
           verification_notes, verified_at, closed_at,
           project_id, vendor_id,
           projects(number, name), vendors(name),
           raiser:profiles!ncrs_raised_by_fkey(full_name),
           verifier:profiles!ncrs_verified_by_fkey(full_name)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('capa_actions')
        .select(
          'kind, description, due_date, status, completed_at, profiles!capa_actions_assigned_to_fkey(full_name)'
        )
        .eq('ncr_id', id)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at'),
      supabase
        .from('attachments')
        .select('id', { count: 'exact', head: true })
        .eq('parent_type', 'ncr')
        .eq('parent_id', id)
        .eq('kind', 'photo'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!ncr) return new Response('Not found', { status: 404 })

  const projectRel = ncr.projects as unknown as { number: string; name: string } | null
  const vendorRel = ncr.vendors as unknown as { name: string } | null
  const raiserRel = ncr.raiser as unknown as { full_name: string } | null
  const verifierRel = ncr.verifier as unknown as { full_name: string } | null

  const { NCR_SOURCE_LABELS } = await import('@/lib/zod')
  const source =
    NCR_SOURCE_LABELS[ncr.source as keyof typeof NCR_SOURCE_LABELS] ??
    (ncr.source as string)

  const pdfActions: NcrPdfAction[] = (actions ?? []).map((a) => {
    const assignee = a.profiles as unknown as { full_name: string } | null
    return {
      kind: a.kind as string,
      description: a.description as string,
      assigned_to: assignee?.full_name ?? null,
      due_date: (a.due_date as string | null) ?? null,
      status: a.status as string,
      completed_at: (a.completed_at as string | null) ?? null,
    }
  })

  const buffer = await renderToBuffer(
    <NcrPdf
      ncr={{
        number: ncr.number as string,
        date: fmtDate((ncr.occurred_on as string | null) ?? (ncr.created_at as string)),
        source,
        severity: Number(ncr.severity),
        status: ncr.status as string,
        occurred: ncr.occurred_on ? fmtDate(ncr.occurred_on as string) : null,
        category: (ncr.category as string | null) ?? null,
        project: projectRel ? `${projectRel.number} — ${projectRel.name}` : null,
        vendor: vendorRel?.name ?? null,
        raisedBy: raiserRel?.full_name ?? null,
        description: ncr.description as string,
        immediateAction: (ncr.immediate_action as string | null) ?? null,
        rootCause: (ncr.root_cause as string | null) ?? null,
        verificationNotes: (ncr.verification_notes as string | null) ?? null,
        verifiedBy: verifierRel?.full_name ?? null,
        verifiedAt: ncr.verified_at ? fmtDate(ncr.verified_at as string) : null,
        closedAt: ncr.closed_at ? fmtDate(ncr.closed_at as string) : null,
        photoCount: (photoCount as unknown as number) ?? 0,
      }}
      company={toCompany(settings)}
      actions={pdfActions}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${ncr.number as string}.pdf"`,
    },
  })
}

// ─── QR sign-on poster ────────────────────────────────────────────────────────

async function qrPosterPdf(id: string, request: Request): Promise<Response> {
  const supabase = await createClient()

  const [{ data: link }, { data: settings }] = await Promise.all([
    supabase
      .from('share_links')
      .select(
        `id, token, kind, label, active,
         swms_instances(title, projects(number, name), jobs(number, title)),
         form_submissions(form_templates(name), projects(number, name), jobs(number, title)),
         projects(number, name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  if (!link || (link.kind !== 'signon' && link.kind !== 'subbie_swms')) {
    return new Response('Not found', { status: 404 })
  }
  const kind = link.kind as 'signon' | 'subbie_swms'

  type ParentRefs = {
    projects: { number: string; name: string } | null
    jobs: { number: string; title: string } | null
  }
  const swmsRel = link.swms_instances as unknown as
    | ({ title: string } & ParentRefs)
    | null
  const submissionRel = link.form_submissions as unknown as
    | ({ form_templates: { name: string } | null } & ParentRefs)
    | null
  // kind 'subbie_swms' targets a project directly.
  const linkProjectRel = link.projects as unknown as {
    number: string
    name: string
  } | null

  const parent = swmsRel ?? submissionRel
  const project = parent?.projects ?? linkProjectRel
  const projectName = project
    ? `${project.number} — ${project.name}`
    : parent?.jobs
      ? `${parent.jobs.number} — ${parent.jobs.title}`
      : null

  const label =
    link.label ??
    swmsRel?.title ??
    submissionRel?.form_templates?.name ??
    (kind === 'subbie_swms' ? 'SWMS submission' : 'Site sign-on')

  const origin =
    process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  const path = kind === 'subbie_swms' ? 'submit' : 'sign'
  const url = `${origin.replace(/\/$/, '')}/${path}/${link.token}`
  const qrDataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 })

  const buffer = await renderToBuffer(
    <QrPosterPdf
      company={toCompany(settings)}
      kind={kind}
      label={label}
      projectName={projectName}
      qrDataUrl={qrDataUrl}
      url={url}
    />
  )

  const filename =
    kind === 'subbie_swms' ? 'swms-submission-poster.pdf' : 'sign-on-poster.pdf'
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  })
}

// ─── Master Document List (controlled register) ───────────────────────────────

async function documentRegisterPdf(): Promise<Response> {
  const supabase = await createClient()

  const [{ data: docs }, { data: settings }] = await Promise.all([
    supabase
      .from('documents')
      .select(
        `id, doc_number, title, category, system, version, status,
         review_due, approved_at, issued_at,
         approver:profiles!documents_approved_by_fkey(full_name)`
      )
      .order('system')
      .order('doc_number', { nullsFirst: false })
      .order('title'),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  const today = todayAU()
  const rows: DocumentRegisterPdfRow[] = (docs ?? []).map((d) => {
    const reviewDue = (d.review_due as string | null) ?? null
    return {
      docNumber: (d.doc_number as string | null) ?? null,
      title: d.title as string,
      category: DOC_CATEGORY_LABELS[d.category as DocCategory] ?? (d.category as string),
      system: DOC_SYSTEM_LABELS[d.system as DocSystem] ?? (d.system as string),
      version: d.version as string,
      status: (d.status as string).replace(/_/g, ' '),
      approved: d.approved_at ? fmtDate(d.approved_at as string) : null,
      issued: d.issued_at ? fmtDate(d.issued_at as string) : null,
      reviewDue: reviewDue ? fmtDate(reviewDue) : null,
      overdue: d.status === 'issued' && reviewDue != null && reviewDue < today,
    }
  })

  const buffer = await renderToBuffer(
    <DocumentRegisterPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      rows={rows}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="master-document-list.pdf"',
    },
  })
}
