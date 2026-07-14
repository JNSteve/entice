import { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { format, parseISO } from 'date-fns'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeClaim, type ClaimLineInput } from '@/lib/claims'
import { lineTotal, round2 } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { buildQuotePdfResponse } from '@/pdf/build-quote-pdf'
import { buildComplianceReportResponse } from '@/pdf/build-compliance-report'
import { buildTakeoffPdfResponse } from '@/pdf/build-takeoff-pdf'
import { buildInvoicePdfResponse } from '@/pdf/build-invoice-pdf'
import { ensureRegisterLink } from '@/lib/client-links'
import { buildHandoverPdfResponse } from '@/pdf/build-handover-pdf'
import { PoPdf } from '@/pdf/PoPdf'
import { ClaimPdf, type ClaimPdfLine } from '@/pdf/ClaimPdf'
import { DiaryPdf, type DiaryPdfDay, type DiaryPdfPhoto } from '@/pdf/DiaryPdf'
import {
  SwmsPdf,
  type SwmsPdfChange,
  type SwmsPdfRow,
  type SwmsPdfSignature,
} from '@/pdf/SwmsPdf'
import {
  HRCW_ANSWER_LABELS,
  SWMS_EMERGENCY_CONTACT_LABELS,
  SWMS_PROJECT_DETAIL_LABELS,
  SWMS_REQUIREMENT_LABELS,
  SWMS_STRUCTURE_COLUMNS,
  parseSwmsStructure,
  type SwmsEmergencyContacts,
  type SwmsProjectDetails,
  type SwmsRequirements,
} from '@/lib/swms'
import { ProgrammePdf, type ProgrammePdfHoldPoint } from '@/pdf/ProgrammePdf'
import { FormPdf, type FormPdfSignon } from '@/pdf/FormPdf'
import { IncidentPdf, type IncidentPdfAction } from '@/pdf/IncidentPdf'
import { NcrPdf, type NcrPdfAction } from '@/pdf/NcrPdf'
import {
  AuditReportPdf,
  type AuditReportPdfChecklistRow,
  type AuditReportPdfFinding,
} from '@/pdf/AuditReportPdf'
import { QrPosterPdf } from '@/pdf/QrPosterPdf'
import { DocumentRegisterPdf, type DocumentRegisterPdfRow } from '@/pdf/DocumentRegisterPdf'
import {
  TrainingMatrixPdf,
  type MatrixPdfCell,
  type MatrixPdfRow,
} from '@/pdf/TrainingMatrixPdf'
import { CompetencyPdf, type CompetencyPdfRecord } from '@/pdf/CompetencyPdf'
import {
  RiskRegisterPdf,
  type RiskRegisterPdfGroup,
  type RiskRegisterPdfRow,
  type RiskRegisterBandCount,
} from '@/pdf/RiskRegisterPdf'
import {
  ObjectivesPdf,
  type ObjectivesPdfObjectiveBlock,
  type ObjectivesPdfSummaryRow,
} from '@/pdf/ObjectivesPdf'
import {
  MgmtReviewPdf,
  type MgmtReviewPdfAttendee,
  type MgmtReviewPdfInput,
  type MgmtReviewPdfAction,
} from '@/pdf/MgmtReviewPdf'
import {
  LegalRegisterPdf,
  type LegalRegisterPdfGroup,
  type LegalRegisterPdfRow,
} from '@/pdf/LegalRegisterPdf'
import { WasteLoadsPdf, type WasteLoadsPdfRow } from '@/pdf/WasteLoadsPdf'
import {
  WasteReconciliationPdf,
  type WasteReconciliationPdfRow,
} from '@/pdf/WasteReconciliationPdf'
import { permitUsage, type WasteUnit } from '@/lib/env'
import { ItpPdf, type ItpPdfItem } from '@/pdf/ItpPdf'
import {
  LotPdf,
  type LotPdfHoldPoint,
  type LotPdfItem,
  type LotPdfTest,
} from '@/pdf/LotPdf'
import { latestEvaluation } from '@/lib/legal'
import {
  MGMT_REVIEW_INPUT_KEYS,
  MGMT_REVIEW_INPUT_DEFS,
  MGMT_REVIEW_STANDARD_LABELS,
  type MgmtReviewInputKey,
} from '@/lib/mgmt-review'
import type { InputSnapshot } from '@/lib/mgmt-review-data'
import {
  deriveObjectiveStatus,
  periodKeyLabel,
  OBJECTIVE_TRAFFIC_LABELS,
} from '@/lib/objectives'
import { latestKpiValue } from '@/lib/objective-queries'
import {
  deriveCompetencyStatus,
  latestRecords,
  workerTypeKey,
  type CompetencyRecordLike,
} from '@/lib/competency'
import {
  DOC_CATEGORY_LABELS,
  DOC_SYSTEM_LABELS,
  COMPETENCY_CATEGORY_LABELS,
  WORKER_ROLE_LABELS,
  RISK_DOMAINS,
  RISK_DOMAIN_LABELS,
  RISK_STATUS_LABELS,
  OBJECTIVE_PERIOD_LABELS,
  OBJECTIVE_SOURCE_LABELS,
  OBJECTIVE_STATUS_LABELS,
  LEGAL_CATEGORY_LABELS,
  LEGAL_JURISDICTION_LABELS,
  COMPLIANCE_STATE_LABELS,
  WASTE_CLASSIFICATIONS,
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNIT_LABELS,
  type DocCategory,
  type DocSystem,
  type CompetencyCategory,
  type WorkerRole,
  type RiskStatus,
  type ObjectiveDirection,
  type ObjectivePeriod,
  type ObjectiveSource,
  type ObjectiveStatus,
  type LegalCategory,
  type LegalJurisdiction,
  type ComplianceState,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import { todayAU } from '@/lib/tz'
import type { FormField, FormTemplateKind } from '@/lib/zod'
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
  const response = await dispatch(request, params)
  // PDFs regenerate from live data — a cached copy silently hides edits
  // (e.g. a footer saved after the browser first opened the PDF tab).
  response.headers.set('Cache-Control', 'no-store')
  return response
}

async function dispatch(
  request: Request,
  params: Promise<{ type: string; id: string }>
) {
  const profile = await getProfile()
  if (!profile) return new Response('Unauthorized', { status: 401 })

  const { type, id } = await params

  const allowedRoles =
    type.startsWith('diary') || type === 'swms' || type === 'programme' || type === 'form' || type === 'incident' || type === 'ncr' || type === 'audit' || type === 'qr-poster' || type === 'document-register' || type === 'training-matrix' || type === 'competency' || type === 'risk-register' || type === 'objectives' || type === 'mgmt-review' || type === 'legal-register' || type === 'waste-loads' || type === 'waste-reconciliation' || type === 'itp' || type === 'lot'
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
    case 'audit':
      return auditPdf(id)
    case 'qr-poster':
      // [id] = share_links row id
      return qrPosterPdf(id, request)
    case 'document-register':
      // [id] is a placeholder (use 'list') — the register PDF covers all docs.
      return documentRegisterPdf()
    case 'training-matrix':
      // [id] is a placeholder (use 'list') — the matrix covers active workers.
      return trainingMatrixPdf()
    case 'competency':
      // [id] = workers row id → per-worker competency report
      return competencyPdf(id)
    case 'risk-register':
      // [id] is a placeholder (use 'list') — the register PDF covers all items.
      return riskRegisterPdf()
    case 'objectives':
      // [id] is a placeholder (use 'list') — covers all objectives + values.
      return objectivesPdf()
    case 'mgmt-review':
      return mgmtReviewPdf(id)
    case 'legal-register':
      // [id] is a placeholder (use 'list') — covers the whole register.
      return legalRegisterPdf()
    case 'waste-loads':
      // [id] is a placeholder (use 'list'); filters echo via query params
      // (?project=&classification=&from=&to=).
      return wasteLoadsPdf(request)
    case 'waste-reconciliation':
      // [id] = project id → permits, allowances, usage for that project.
      return wasteReconciliationPdf(id)
    case 'itp':
      // [id] = itp_instances row id → adopted checklist with statuses
      return itpPdf(id)
    case 'lot':
      // [id] = lots row id → Lot Conformance Report
      return lotPdf(id)
    case 'handover': {
      // [id] = job or project id; ?kind=job|project (CP3 closeout dossier).
      // Money roles only (it lists issued invoices/claims) — the default.
      const url = new URL(request.url)
      const supabase = await createClient()
      return buildHandoverPdfResponse(
        supabase,
        url.searchParams.get('kind') ?? 'job',
        id
      )
    }
    case 'compliance-report': {
      // [id] = client id → portfolio property-compliance report (no money;
      // money-roles default gate keeps it admin/office like the client pages).
      const supabase = await createClient()
      return buildComplianceReportResponse(supabase, id)
    }
    case 'takeoff': {
      // [id] = quote id → takeoff schedule (estimating audit trail; costs +
      // sell, so the money-roles default gate keeps it admin/office).
      const supabase = await createClient()
      return buildTakeoffPdfResponse(supabase, id)
    }
    case 'portal-register':
      // [id] = site id → "Asbestos register — scan to view" wall poster,
      // pointing at the site's compliance-only register portal link
      // (create-or-reuse). Admin/office (money default).
      return portalRegisterPosterPdf(id, request)
    default:
      return new Response('Not found', { status: 404 })
  }
}

async function invoicePdf(id: string): Promise<Response> {
  // Shared builder (also used by the token-gated portal proxy).
  const supabase = await createClient()
  return buildInvoicePdfResponse(supabase, id)
}

async function quotePdf(id: string): Promise<Response> {
  // Shared builder (also used by the token-gated portal proxy) — includes the
  // portal-acceptance evidence block when the quote was signed on the glass.
  const supabase = await createClient()
  return buildQuotePdfResponse(supabase, id)
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

/** Non-empty {label, value} rows from a label map + values record. */
function labelValueRows(
  labels: Record<string, string>,
  values: Record<string, string>
): SwmsPdfRow[] {
  return Object.entries(labels)
    .filter(([key]) => values[key]?.trim())
    .map(([key, label]) => ({ label, value: values[key] }))
}

async function swmsPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: instance }, { data: signatures }, { data: auditRows }, { data: settings }] =
    await Promise.all([
      supabase
        .from('swms_instances')
        .select(
          `id, title, body, hazards, version, status, created_at, ${SWMS_STRUCTURE_COLUMNS},
           projects(number, name), jobs(number, title)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('swms_signatures')
        .select(
          'name, company, external, signature_path, signature_data, version, signed_at, profiles(role)'
        )
        .eq('swms_instance_id', id)
        .order('signed_at'),
      supabase
        .from('audit_log')
        .select('at, actor_name, action, detail')
        .eq('entity_type', 'swms_instances')
        .eq('entity_id', id)
        .order('at'),
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

  const structure = parseSwmsStructure(instance)

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
    const profileRel = s.profiles as unknown as { role: string } | null
    const role = external
      ? 'External'
      : profileRel?.role
        ? profileRel.role.charAt(0).toUpperCase() + profileRel.role.slice(1)
        : '—'
    return {
      name: s.name as string,
      role,
      company: external ? (company ?? '—') : (settings?.company_name ?? '—'),
      date: fmtDate(s.signed_at),
      version: Number(s.version),
      imageUrl: s.signature_path
        ? (urlByPath.get(s.signature_path as string) ?? null)
        : ((s.signature_data as string | null) ?? null),
    }
  })

  // Review/change record: issue + version bumps + supersede from the audit log.
  const changes: SwmsPdfChange[] = []
  for (const row of auditRows ?? []) {
    const detail = (row.detail ?? {}) as {
      changed?: Record<string, { from?: unknown; to?: unknown }>
    }
    if (row.action === 'insert') {
      changes.push({
        date: fmtDate(row.at as string),
        description: 'Issued (v1)',
        by: (row.actor_name as string) ?? 'system',
      })
    } else if (row.action === 'update' && detail.changed?.version) {
      changes.push({
        date: fmtDate(row.at as string),
        description: `Revised to v${detail.changed.version.to} — workers must re-sign`,
        by: (row.actor_name as string) ?? 'system',
      })
    } else if (row.action === 'update' && detail.changed?.status) {
      changes.push({
        date: fmtDate(row.at as string),
        description: `Status changed to ${String(detail.changed.status.to).replace(/"/g, '')}`,
        by: (row.actor_name as string) ?? 'system',
      })
    }
  }

  const docControlRows: SwmsPdfRow[] = [
    structure.docControl.prepared_by.trim()
      ? { label: 'Prepared by', value: structure.docControl.prepared_by }
      : null,
    structure.docControl.approved_by.trim()
      ? { label: 'Approved by', value: structure.docControl.approved_by }
      : null,
  ].filter((r): r is SwmsPdfRow => r !== null)

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
      docControl={docControlRows}
      scopeNote={structure.docControl.scope_note.trim()}
      projectDetails={labelValueRows(
        SWMS_PROJECT_DETAIL_LABELS,
        structure.projectDetails as SwmsProjectDetails
      )}
      hrcw={structure.hrcwItems.map((item) => ({
        label: item.label,
        value: structure.hrcwAnswers[item.id]
          ? HRCW_ANSWER_LABELS[structure.hrcwAnswers[item.id]]
          : '—',
      }))}
      requirements={labelValueRows(
        SWMS_REQUIREMENT_LABELS,
        structure.requirements as SwmsRequirements
      )}
      steps={structure.steps}
      stopWorkTriggers={structure.stopWorkTriggers}
      emergencyContacts={labelValueRows(
        SWMS_EMERGENCY_CONTACT_LABELS,
        structure.emergencyContacts as SwmsEmergencyContacts
      )}
      emergencyScenarios={structure.emergencyScenarios}
      referencesList={structure.referencesList}
      signatures={pdfSignatures}
      earlierSignatureCount={earlierSignatureCount}
      changes={changes}
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
      // Quality-origin (lot) hold points have no task — programme PDF shows
      // task hold points only (lot releases appear on the Lot report).
      .eq('origin', 'programme')
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
        `id, kind, template_id, template_version, submitted_at, data, schema_snapshot,
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

  // Prefer the schema captured at submit time; legacy rows fall back to the
  // template's CURRENT schema.
  const schema = ((submission.schema_snapshot as FormField[] | null) ??
    templateRel?.schema ??
    []) as FormField[]

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

// ─── Internal audit report ────────────────────────────────────────────────────

async function auditPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: audit }, { data: findings }, { data: settings }] =
    await Promise.all([
      supabase
        .from('audits')
        .select(
          `id, number, standards, auditee, planned_date, conducted_date,
           status, summary, closed_at, created_at,
           audit_programmes(year, title),
           audit_areas(name),
           auditor:profiles!audits_auditor_id_fkey(full_name),
           checklist_template:form_templates(name),
           checklist_submission:form_submissions(data, schema_snapshot)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('audit_findings')
        .select('classification, clause_ref, description, status, ncrs(number, status)')
        .eq('audit_id', id)
        .order('created_at'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!audit) return new Response('Not found', { status: 404 })

  const programmeRel = audit.audit_programmes as unknown as {
    year: string
    title: string
  } | null
  const areaRel = audit.audit_areas as unknown as { name: string } | null
  const auditorRel = audit.auditor as unknown as { full_name: string } | null
  const templateRel = audit.checklist_template as unknown as { name: string } | null
  const submissionRel = audit.checklist_submission as unknown as {
    data: Record<string, unknown>
    schema_snapshot: FormField[] | null
  } | null

  const { AUDIT_STANDARD_LABELS, FINDING_CLASSIFICATION_LABELS } = await import(
    '@/lib/zod'
  )

  const standards = ((audit.standards as string[]) ?? [])
    .map(
      (s) =>
        AUDIT_STANDARD_LABELS[s as keyof typeof AUDIT_STANDARD_LABELS] ?? s
    )
    .join(', ')

  // Checklist summary rendered against the snapshot captured at conduct time.
  const checklistRows: AuditReportPdfChecklistRow[] = (
    submissionRel?.schema_snapshot ?? []
  )
    .filter((f) => f.type !== 'photo')
    .map((f) => {
      const raw = submissionRel?.data?.[f.key]
      const value =
        raw === undefined || raw === null || raw === ''
          ? '—'
          : typeof raw === 'boolean'
            ? raw
              ? 'Yes'
              : 'No'
            : String(raw)
      return { label: f.label, value }
    })

  const pdfFindings: AuditReportPdfFinding[] = (findings ?? []).map((f) => {
    const ncrRel = f.ncrs as unknown as { number: string; status: string } | null
    return {
      classification:
        FINDING_CLASSIFICATION_LABELS[
          f.classification as keyof typeof FINDING_CLASSIFICATION_LABELS
        ] ?? (f.classification as string),
      clause_ref: (f.clause_ref as string | null) ?? null,
      description: f.description as string,
      status: f.status as string,
      ncr_number: ncrRel?.number ?? null,
      ncr_status: ncrRel?.status ?? null,
    }
  })

  const buffer = await renderToBuffer(
    <AuditReportPdf
      audit={{
        number: audit.number as string,
        date: fmtDate(
          (audit.conducted_date as string | null) ??
            (audit.planned_date as string | null) ??
            (audit.created_at as string)
        ),
        programme: programmeRel?.year ?? '—',
        area: areaRel?.name ?? '—',
        standards: standards || '—',
        status: audit.status as string,
        auditor: auditorRel?.full_name ?? null,
        auditee: (audit.auditee as string | null) ?? null,
        planned: audit.planned_date ? fmtDate(audit.planned_date as string) : null,
        conducted: audit.conducted_date
          ? fmtDate(audit.conducted_date as string)
          : null,
        closed: audit.closed_at ? fmtDate(audit.closed_at as string) : null,
        summary: (audit.summary as string | null) ?? null,
        checklistName: templateRel?.name ?? null,
      }}
      company={toCompany(settings)}
      checklist={checklistRows}
      findings={pdfFindings}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${audit.number as string}.pdf"`,
    },
  })
}

// ─── QR sign-on poster ────────────────────────────────────────────────────────

/**
 * "Asbestos register — scan to view" A4 wall poster for a site: ensures the
 * site's register-scope portal link exists, QR-encodes its URL and renders
 * the shared poster shell. The register must be readily accessible at the
 * workplace — this makes the portal that accessible copy.
 */
async function portalRegisterPosterPdf(
  siteId: string,
  request: Request
): Promise<Response> {
  const supabase = await createClient()

  const [{ data: site }, { data: settings }, link] = await Promise.all([
    supabase
      .from('sites')
      .select('id, name, clients(name)')
      .eq('id', siteId)
      .single(),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
    ensureRegisterLink(siteId),
  ])
  if (!site) return new Response('Not found', { status: 404 })
  if (link.error || !link.token) {
    return new Response(link.error ?? 'Could not issue the register link', {
      status: 500,
    })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  const url = `${origin.replace(/\/$/, '')}/portal/${link.token}`
  const qrDataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 })

  const clientRel = site.clients as unknown as { name: string } | null
  const buffer = await renderToBuffer(
    <QrPosterPdf
      company={toCompany(settings)}
      kind="register"
      label={site.name as string}
      projectName={clientRel?.name ?? null}
      qrDataUrl={qrDataUrl}
      url={url}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="site-register-poster.pdf"',
    },
  })
}

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

// ─── Training & competency (ISO 7.2) ─────────────────────────────────────────

const COMPETENCY_RECORD_COLUMNS =
  'id, number, worker_id, competency_type_id, issuer, reference_no, issue_date, expiry_date, superseded_by, created_at'

async function trainingMatrixPdf(): Promise<Response> {
  const supabase = await createClient()

  const [{ data: workers }, { data: types }, { data: records }, { data: requirements }, { data: settings }] =
    await Promise.all([
      supabase
        .from('workers')
        .select('id, name, company, role')
        .eq('active', true)
        .order('name'),
      supabase
        .from('competency_types')
        .select('id, name, active')
        .order('name'),
      supabase
        .from('competency_records')
        .select(COMPETENCY_RECORD_COLUMNS)
        .is('superseded_by', null),
      supabase
        .from('role_competency_requirements')
        .select('role, competency_type_id, is_mandatory'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  const today = todayAU()
  const latest = latestRecords((records ?? []) as CompetencyRecordLike[])

  // Columns: types required by at least one role (matching the on-screen matrix).
  const requiredIds = new Set((requirements ?? []).map((r) => r.competency_type_id as string))
  const matrixTypes = (types ?? []).filter(
    (t) => (t.active as boolean) && requiredIds.has(t.id as string)
  )
  const reqByRoleType = new Set(
    (requirements ?? []).map((r) => `${r.role}::${r.competency_type_id}`)
  )

  const rows: MatrixPdfRow[] = (workers ?? []).map((w) => {
    const cells: MatrixPdfCell[] = matrixTypes.map((t) => {
      const rec = latest.get(workerTypeKey(w.id as string, t.id as string))
      const required = reqByRoleType.has(`${w.role}::${t.id}`)
      if (!rec && !required) return { status: null, expiry: null }
      if (!rec) return { status: 'missing', expiry: null }
      return {
        status: deriveCompetencyStatus(rec.expiry_date, today),
        expiry: rec.expiry_date ? fmtDate(rec.expiry_date) : null,
      }
    })
    return {
      worker: w.name as string,
      role: WORKER_ROLE_LABELS[w.role as WorkerRole] ?? (w.role as string),
      company: (w.company as string | null) ?? null,
      cells,
    }
  })

  const buffer = await renderToBuffer(
    <TrainingMatrixPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      typeNames={matrixTypes.map((t) => t.name as string)}
      rows={rows}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="competency-matrix.pdf"',
    },
  })
}

async function competencyPdf(workerId: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: worker }, { data: records }, { data: types }, { data: settings }] =
    await Promise.all([
      supabase
        .from('workers')
        .select('id, name, company, role')
        .eq('id', workerId)
        .single(),
      supabase
        .from('competency_records')
        .select(COMPETENCY_RECORD_COLUMNS)
        .eq('worker_id', workerId)
        .order('issue_date', { ascending: false }),
      supabase
        .from('competency_types')
        .select('id, name, category, active'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!worker) return new Response('Not found', { status: 404 })

  const { data: requirements } = await supabase
    .from('role_competency_requirements')
    .select('competency_type_id, is_mandatory')
    .eq('role', worker.role as string)

  const today = todayAU()
  const typeById = new Map(
    (types ?? []).map((t) => [
      t.id as string,
      { name: t.name as string, category: t.category as CompetencyCategory, active: t.active as boolean },
    ])
  )
  const latest = latestRecords((records ?? []) as CompetencyRecordLike[])

  const pdfRequirements = ((requirements ?? []) as { competency_type_id: string; is_mandatory: boolean }[])
    .map((req) => {
      const type = typeById.get(req.competency_type_id)
      if (!type || !type.active) return null
      const rec = latest.get(workerTypeKey(worker.id as string, req.competency_type_id))
      const statusLabel = rec
        ? rec.expiry_date
          ? `${
              { current: 'Current', expiring: 'Expiring', expired: 'Expired' }[
                deriveCompetencyStatus(rec.expiry_date, today)
              ]
            } — expires ${fmtDate(rec.expiry_date)}`
          : 'Current — no expiry'
        : 'No record on file'
      return { name: type.name, statusLabel, mandatory: req.is_mandatory }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  const pdfRecords: CompetencyPdfRecord[] = (records ?? []).map((r) => {
    const type = typeById.get(r.competency_type_id as string)
    return {
      number: r.number as string,
      competency: type?.name ?? '—',
      category: type ? COMPETENCY_CATEGORY_LABELS[type.category] : '—',
      issuer: (r.issuer as string | null) ?? null,
      reference: (r.reference_no as string | null) ?? null,
      issued: fmtDate(r.issue_date as string),
      expiry: r.expiry_date ? fmtDate(r.expiry_date as string) : null,
      status: r.superseded_by
        ? 'superseded'
        : deriveCompetencyStatus((r.expiry_date as string | null) ?? null, today),
    }
  })

  const buffer = await renderToBuffer(
    <CompetencyPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      worker={{
        name: worker.name as string,
        role: WORKER_ROLE_LABELS[worker.role as WorkerRole] ?? (worker.role as string),
        company: (worker.company as string | null) ?? null,
      }}
      requirements={pdfRequirements}
      records={pdfRecords}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="competency-${(worker.name as string).replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}.pdf"`,
    },
  })
}

// ─── Risk & Opportunity register (ISO 6.1) ────────────────────────────────────

async function riskRegisterPdf(): Promise<Response> {
  const supabase = await createClient()

  const [{ data: items }, { data: settings }] = await Promise.all([
    supabase
      .from('risk_items')
      .select(
        `id, number, kind, title, iso_domain, category, status, review_date,
         likelihood, consequence, inherent_score, inherent_rating,
         residual_score, residual_rating,
         projects(number, name),
         owner:profiles!risk_items_owner_id_fkey(full_name)`
      )
      .order('iso_domain')
      .order('number'),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  const today = todayAU()

  // Band summary (the heat-map counts-per-band table).
  const bandCounts: RiskRegisterBandCount[] = (
    ['Low', 'Medium', 'High', 'Extreme'] as const
  ).map((band) => ({
    band,
    inherent: (items ?? []).filter((r) => r.inherent_rating === band).length,
    residual: (items ?? []).filter((r) => r.residual_rating === band).length,
  }))

  // Group by ISO domain in a fixed, meaningful order.
  const groups: RiskRegisterPdfGroup[] = RISK_DOMAINS.map((domain) => ({
    domain: RISK_DOMAIN_LABELS[domain],
    rows: (items ?? [])
      .filter((r) => r.iso_domain === domain)
      .map((r): RiskRegisterPdfRow => {
        const project = r.projects as unknown as {
          number: string
          name: string
        } | null
        const owner = r.owner as unknown as { full_name: string } | null
        const reviewDue = (r.review_date as string | null) ?? null
        return {
          number: r.number as string,
          kind: r.kind as 'risk' | 'opportunity',
          title: r.title as string,
          category: (r.category as string | null) ?? null,
          scope: project ? project.number : 'Company-wide',
          likelihood: Number(r.likelihood),
          consequence: Number(r.consequence),
          inherentScore: Number(r.inherent_score),
          inherentRating: r.inherent_rating as string,
          residualScore:
            r.residual_score == null ? null : Number(r.residual_score),
          residualRating: (r.residual_rating as string | null) ?? null,
          status:
            RISK_STATUS_LABELS[r.status as RiskStatus] ?? (r.status as string),
          owner: owner?.full_name ?? null,
          reviewDue: reviewDue ? fmtDate(reviewDue) : null,
          reviewOverdue:
            r.status !== 'closed' && reviewDue != null && reviewDue < today,
        }
      }),
  })).filter((g) => g.rows.length > 0)

  const buffer = await renderToBuffer(
    <RiskRegisterPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      groups={groups}
      bandCounts={bandCounts}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="risk-register.pdf"',
    },
  })
}

// ─── Objectives & KPIs (ISO 6.2 / 9.1) ───────────────────────────────────────

async function objectivesPdf(): Promise<Response> {
  const supabase = await createClient()

  const [{ data: objectives }, { data: values }, { data: settings }] =
    await Promise.all([
      supabase
        .from('objectives')
        .select(
          `id, number, title, iso_domain, metric_name, unit, target_value,
           direction, period, source, status,
           owner:profiles!objectives_owner_id_fkey(full_name)`
        )
        .order('number'),
      supabase
        .from('kpi_values')
        .select(
          `objective_id, period_key, value, note, computed_at,
           enterer:profiles!kpi_values_entered_by_fkey(full_name)`
        )
        .order('period_key'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  const fmtValue = (value: number, unit: string): string => {
    const n = parseFloat(value.toFixed(2))
    return unit === '%' ? `${n}%` : String(n)
  }

  type ValueRel = {
    objective_id: string
    period_key: string
    value: number
    note: string | null
    computed_at: string
    enterer: { full_name: string } | null
  }
  const valuesByObjective = new Map<string, ValueRel[]>()
  for (const raw of values ?? []) {
    const v = raw as unknown as ValueRel
    const list = valuesByObjective.get(v.objective_id)
    if (list) list.push(v)
    else valuesByObjective.set(v.objective_id, [v])
  }

  const summary: ObjectivesPdfSummaryRow[] = []
  const blocks: ObjectivesPdfObjectiveBlock[] = []

  for (const o of objectives ?? []) {
    const direction = o.direction as ObjectiveDirection
    const unit = o.unit as string
    const target = Number(o.target_value)
    // Font-safe wording — '≤'/'≥' glyphs are missing from the WinAnsi PDF
    // font encoding (same fix as the management-review PDF).
    const targetStr = `${direction === 'at_most' ? 'at most' : 'at least'} ${fmtValue(target, unit)}`
    const series = (valuesByObjective.get(o.id as string) ?? []).map((v) => ({
      ...v,
      value: Number(v.value),
    }))
    const latest = latestKpiValue(series)
    const traffic = deriveObjectiveStatus(direction, target, latest?.value ?? null)
    const owner = o.owner as unknown as { full_name: string } | null

    summary.push({
      number: o.number as string,
      title: o.title as string,
      domain: RISK_DOMAIN_LABELS[o.iso_domain as keyof typeof RISK_DOMAIN_LABELS],
      metric: o.metric_name as string,
      target: targetStr,
      period: OBJECTIVE_PERIOD_LABELS[o.period as ObjectivePeriod],
      source: OBJECTIVE_SOURCE_LABELS[o.source as ObjectiveSource],
      latestPeriod: latest ? periodKeyLabel(latest.period_key) : null,
      latestValue: latest ? fmtValue(latest.value, unit) : null,
      traffic,
      trafficLabel: OBJECTIVE_TRAFFIC_LABELS[traffic],
      owner: owner?.full_name ?? null,
      status: OBJECTIVE_STATUS_LABELS[o.status as ObjectiveStatus],
    })

    blocks.push({
      number: o.number as string,
      title: o.title as string,
      metric: `${o.metric_name as string} (${unit})`,
      target: targetStr,
      values: [...series]
        .sort((a, b) => b.period_key.localeCompare(a.period_key))
        .map((v) => {
          const s = deriveObjectiveStatus(direction, target, v.value)
          return {
            period: periodKeyLabel(v.period_key),
            value: fmtValue(v.value, unit),
            traffic: s,
            trafficLabel: OBJECTIVE_TRAFFIC_LABELS[s],
            note: v.note,
            source: v.enterer?.full_name ?? 'Auto',
            recorded: fmtDate(v.computed_at),
          }
        }),
    })
  }

  const buffer = await renderToBuffer(
    <ObjectivesPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      summary={summary}
      blocks={blocks}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="objectives-kpis.pdf"',
    },
  })
}

// ─── Management Review Report (ISO 9.3) ───────────────────────────────────────

async function mgmtReviewPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: review }, { data: inputs }, { data: attendees }, { data: actions }, { data: settings }] =
    await Promise.all([
      supabase
        .from('management_reviews')
        .select(
          `id, number, review_date, period_covered, status, general_minutes,
           closed_at,
           chair:profiles!management_reviews_chaired_by_fkey(full_name)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('management_review_inputs')
        .select(
          `input_key, rag, minute, data, reviewed, reviewed_at,
           reviewer:profiles!management_review_inputs_reviewed_by_fkey(full_name)`
        )
        .eq('review_id', id),
      supabase
        .from('management_review_attendees')
        .select(
          `profile_id, name, role_title,
           profiles!management_review_attendees_profile_id_fkey(full_name)`
        )
        .eq('review_id', id)
        .order('created_at'),
      supabase
        .from('management_review_actions')
        .select(
          `description, due_date, status, completed_at,
           profiles!management_review_actions_assigned_to_fkey(full_name)`
        )
        .eq('review_id', id)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!review) return new Response('Not found', { status: 404 })

  const { RAG_LABELS } = await import('@/lib/zod')

  const chairRel = review.chair as unknown as { full_name: string } | null

  // Render in the controlled-list order — the auditor reads 9.3.2 top to bottom.
  const inputByKey = new Map(
    (inputs ?? []).map((i) => [i.input_key as MgmtReviewInputKey, i])
  )
  const pdfInputs: MgmtReviewPdfInput[] = MGMT_REVIEW_INPUT_KEYS.flatMap((key) => {
    const i = inputByKey.get(key)
    if (!i) return []
    const def = MGMT_REVIEW_INPUT_DEFS[key]
    const snapshot = (i.data as InputSnapshot | null) ?? null
    const reviewer = i.reviewer as unknown as { full_name: string } | null
    const rag = (i.rag as 'green' | 'amber' | 'red' | null) ?? null
    return [
      {
        label: def.label,
        standards: def.standards
          .map((s) => MGMT_REVIEW_STANDARD_LABELS[s])
          .join(', '),
        rag,
        ragLabel: rag ? RAG_LABELS[rag] : null,
        minute: (i.minute as string | null) ?? null,
        reviewed: Boolean(i.reviewed),
        reviewedLine: i.reviewed
          ? `Reviewed${reviewer ? ` by ${reviewer.full_name}` : ''}${
              i.reviewed_at ? ` on ${fmtDate(i.reviewed_at as string)}` : ''
            }`
          : null,
        windowLine: snapshot
          ? `Register data ${fmtDate(snapshot.window.start)} – ${fmtDate(snapshot.window.end)} (${
              snapshot.window.basis === 'last_closed_review'
                ? 'since the last closed review'
                : 'trailing 12 months'
            }), snapshot taken ${fmtDate(snapshot.computed_at)}`
          : null,
        figures: snapshot?.figures ?? [],
        rows: snapshot?.rows ?? [],
      },
    ]
  })

  const pdfAttendees: MgmtReviewPdfAttendee[] = (attendees ?? []).map((a) => {
    const p = a.profiles as unknown as { full_name: string } | null
    return {
      name: p?.full_name ?? (a.name as string | null) ?? '—',
      role_title: (a.role_title as string | null) ?? null,
      external: a.profile_id == null,
    }
  })

  const pdfActions: MgmtReviewPdfAction[] = (actions ?? []).map((a) => {
    const assignee = a.profiles as unknown as { full_name: string } | null
    return {
      description: a.description as string,
      assigned_to: assignee?.full_name ?? null,
      due_date: a.due_date ? fmtDate(a.due_date as string) : null,
      status: a.status as string,
      completed_at: a.completed_at ? fmtDate(a.completed_at as string) : null,
    }
  })

  const buffer = await renderToBuffer(
    <MgmtReviewPdf
      review={{
        number: review.number as string,
        date: fmtDate(review.review_date as string),
        periodCovered: (review.period_covered as string | null) ?? null,
        chair: chairRel?.full_name ?? null,
        status: review.status as string,
        closed: review.closed_at ? fmtDate(review.closed_at as string) : null,
        generalMinutes: (review.general_minutes as string | null) ?? null,
      }}
      company={toCompany(settings)}
      attendees={pdfAttendees}
      inputs={pdfInputs}
      actions={pdfActions}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${review.number as string}-management-review.pdf"`,
    },
  })
}

// ─── Legal & Compliance Obligations Register (ISO 6.1.3 / 9.1.2) ─────────────

async function legalRegisterPdf(): Promise<Response> {
  const supabase = await createClient()

  const [{ data: obligations }, { data: evaluations }, { data: settings }] =
    await Promise.all([
      supabase
        .from('legal_obligations')
        .select(
          `id, number, title, category, jurisdiction, iso_domain,
           how_we_comply, next_review_date, current_compliance, status,
           responsible:profiles!legal_obligations_responsible_id_fkey(full_name)`
        )
        .order('iso_domain')
        .order('number'),
      supabase
        .from('compliance_evaluations')
        .select('obligation_id, evaluated_on, verdict, created_at'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  const today = todayAU()

  type EvalRel = {
    obligation_id: string
    evaluated_on: string
    verdict: string
    created_at: string
  }
  const evalsByObligation = new Map<string, EvalRel[]>()
  for (const raw of evaluations ?? []) {
    const e = raw as unknown as EvalRel
    const list = evalsByObligation.get(e.obligation_id)
    if (list) list.push(e)
    else evalsByObligation.set(e.obligation_id, [e])
  }

  // Group by ISO domain in the fixed register order.
  const groups: LegalRegisterPdfGroup[] = RISK_DOMAINS.map((domain) => ({
    domain: RISK_DOMAIN_LABELS[domain],
    rows: (obligations ?? [])
      .filter((o) => o.iso_domain === domain)
      .map((o): LegalRegisterPdfRow => {
        const responsible = o.responsible as unknown as {
          full_name: string
        } | null
        const latest = latestEvaluation(
          evalsByObligation.get(o.id as string) ?? []
        )
        const compliance = o.current_compliance as ComplianceState
        const nextReview = (o.next_review_date as string | null) ?? null
        return {
          number: o.number as string,
          title: o.title as string,
          categoryJurisdiction: `${
            LEGAL_CATEGORY_LABELS[o.category as LegalCategory]
          } · ${LEGAL_JURISDICTION_LABELS[o.jurisdiction as LegalJurisdiction]}`,
          howWeComply: (o.how_we_comply as string | null) ?? null,
          responsible: responsible?.full_name ?? null,
          lastVerdict: latest
            ? `${COMPLIANCE_STATE_LABELS[latest.verdict as ComplianceState]} — ${fmtDate(latest.evaluated_on)}`
            : 'Not evaluated',
          compliance,
          nextReview: nextReview ? fmtDate(nextReview) : null,
          reviewOverdue:
            o.status === 'active' && nextReview != null && nextReview < today,
          retired: o.status === 'retired',
        }
      }),
  })).filter((g) => g.rows.length > 0)

  const buffer = await renderToBuffer(
    <LegalRegisterPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      groups={groups}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="legal-register.pdf"',
    },
  })
}

// ─── Environmental: waste loads register + reconciliation (ISO 14001) ────────

type WasteLoadPdfQueryRow = {
  number: string
  date: string
  classification: string
  classification_detail: string | null
  qty: number
  unit: string
  transporter: string | null
  docket_ref: string | null
  override_reason: string | null
  projects: { number: string; name: string } | null
  jobs: { number: string; title: string } | null
  env_facilities: { name: string } | null
  env_permits: { reference: string } | null
}

/** e.g. '142.5 t · 36 m³ across 18 loads' */
function wasteTotalsLabel(rows: { qty: number; unit: string }[]): string {
  const byUnit = new Map<string, number>()
  for (const r of rows) {
    byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.qty)
  }
  const parts = [...byUnit.entries()].map(
    ([unit, total]) =>
      `${Math.round(total * 100) / 100} ${WASTE_UNIT_LABELS[unit as WasteUnitKey] ?? unit}`
  )
  return `${parts.length > 0 ? parts.join(' · ') : '0'} across ${rows.length} load${rows.length === 1 ? '' : 's'}`
}

async function wasteLoadsPdf(request: Request): Promise<Response> {
  const supabase = await createClient()

  const url = new URL(request.url)
  const projectFilter = url.searchParams.get('project')
  const classificationFilter = url.searchParams.get('classification')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const dateRe = /^\d{4}-\d{2}-\d{2}$/

  let query = supabase
    .from('waste_loads')
    .select(
      `number, date, classification, classification_detail, qty, unit,
       transporter, docket_ref, override_reason,
       projects(number, name), jobs(number, title),
       env_facilities(name), env_permits(reference)`
    )
    .order('date', { ascending: false })
    .order('number', { ascending: false })

  const filterParts: string[] = []
  if (projectFilter) {
    query = query.eq('project_id', projectFilter)
  }
  if (
    classificationFilter &&
    (WASTE_CLASSIFICATIONS as readonly string[]).includes(classificationFilter)
  ) {
    query = query.eq('classification', classificationFilter)
    filterParts.push(
      WASTE_CLASSIFICATION_LABELS[classificationFilter as WasteClassification]
    )
  }
  if (from && dateRe.test(from)) {
    query = query.gte('date', from)
    filterParts.push(`from ${fmtDate(from)}`)
  }
  if (to && dateRe.test(to)) {
    query = query.lte('date', to)
    filterParts.push(`to ${fmtDate(to)}`)
  }

  const [{ data: loads }, { data: settings }, projectRow] = await Promise.all([
    query,
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
    projectFilter
      ? supabase
          .from('projects')
          .select('number, name')
          .eq('id', projectFilter)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (projectRow.data) {
    filterParts.unshift(`${projectRow.data.number} — ${projectRow.data.name}`)
  }

  const shaped = ((loads ?? []) as unknown as WasteLoadPdfQueryRow[]).map((l) => ({
    ...l,
    qty: Number(l.qty),
  }))

  const rows: WasteLoadsPdfRow[] = shaped.map((l) => ({
    number: l.number,
    date: fmtDate(l.date),
    target: l.projects
      ? `${l.projects.number} — ${l.projects.name}`
      : l.jobs
        ? `${l.jobs.number} — ${l.jobs.title}`
        : '—',
    classification:
      WASTE_CLASSIFICATION_LABELS[l.classification as WasteClassification] ??
      l.classification,
    detail: l.classification_detail,
    qty: `${l.qty} ${WASTE_UNIT_LABELS[l.unit as WasteUnitKey] ?? l.unit}`,
    facility: l.env_facilities?.name ?? null,
    transporter: l.transporter,
    docket: l.docket_ref,
    permit: l.env_permits?.reference ?? null,
    override: l.override_reason != null,
  }))

  const buffer = await renderToBuffer(
    <WasteLoadsPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      filtersLabel={filterParts.length > 0 ? filterParts.join(' · ') : null}
      rows={rows}
      totalsLabel={wasteTotalsLabel(shaped)}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="waste-loads.pdf"',
    },
  })
}

async function wasteReconciliationPdf(projectId: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: project }, { data: permits }, { data: loads }, { data: settings }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('number, name')
        .eq('id', projectId)
        .single(),
      supabase
        .from('env_permits')
        .select(
          'id, reference, description, classification, allowance_qty, allowance_unit, expiry'
        )
        .eq('project_id', projectId)
        .order('created_at'),
      supabase
        .from('waste_loads')
        .select('permit_id, qty, unit')
        .eq('project_id', projectId),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!project) return new Response('Not found', { status: 404 })

  const today = todayAU()
  const allLoads = (loads ?? []).map((l) => ({
    permit_id: (l.permit_id as string | null) ?? null,
    qty: Number(l.qty),
    unit: l.unit as WasteUnit,
  }))

  const rows: WasteReconciliationPdfRow[] = (permits ?? []).map((p) => {
    const unit = p.allowance_unit as WasteUnitKey
    const usage = permitUsage(
      Number(p.allowance_qty),
      unit as WasteUnit,
      allLoads.filter((l) => l.permit_id === (p.id as string))
    )
    const expiry = (p.expiry as string | null) ?? null
    return {
      reference: p.reference as string,
      description: (p.description as string | null) ?? null,
      classification:
        WASTE_CLASSIFICATION_LABELS[p.classification as WasteClassification] ??
        (p.classification as string),
      allowance: `${Number(p.allowance_qty)} ${WASTE_UNIT_LABELS[unit]}`,
      used: `${usage.used} ${WASTE_UNIT_LABELS[unit]}`,
      pctUsed: usage.pctUsed === null ? null : `${usage.pctUsed}%`,
      level: usage.level,
      expiry: expiry ? fmtDate(expiry) : null,
      expired: expiry != null && expiry < today,
      otherUnitCount: usage.otherUnitCount,
    }
  })

  const unallocated = allLoads.filter((l) => l.permit_id === null).length
  const loadsSummary = `${wasteTotalsLabel(allLoads)}${
    unallocated > 0
      ? ` (${unallocated} load${unallocated === 1 ? '' : 's'} not booked to a permit)`
      : ''
  }`

  const buffer = await renderToBuffer(
    <WasteReconciliationPdf
      company={toCompany(settings)}
      printedDate={fmtDate(new Date())}
      project={{ number: project.number as string, name: project.name as string }}
      rows={rows}
      loadsSummary={loadsSummary}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="waste-reconciliation-${project.number as string}.pdf"`,
    },
  })
}

// ─── ITP / Lot conformance (ISO 9001 8.5/8.6/8.7) ─────────────────────────────

async function itpPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const [{ data: itp }, { data: items }, { data: lotCountRows }, { data: settings }] =
    await Promise.all([
      supabase
        .from('itp_instances')
        .select(
          `number, title, activity, status, adopted_at,
           projects(number, name),
           adopter:profiles!itp_instances_adopted_by_fkey(full_name)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('itp_instance_items')
        .select(
          `position, description, acceptance_criteria, spec_ref, point_type,
           record_required, responsible, status, checked_at,
           checker:profiles!itp_instance_items_checked_by_fkey(full_name)`
        )
        .eq('instance_id', id)
        .order('position'),
      supabase.from('lots').select('id').eq('itp_instance_id', id),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!itp) return new Response('Not found', { status: 404 })

  const project = itp.projects as unknown as { number: string; name: string } | null
  const adopter = itp.adopter as unknown as { full_name: string } | null

  const pdfItems: ItpPdfItem[] = (items ?? []).map((it) => {
    const checker = it.checker as unknown as { full_name: string } | null
    return {
      position: it.position as number,
      description: it.description as string,
      acceptance_criteria: it.acceptance_criteria as string,
      spec_ref: (it.spec_ref as string | null) ?? null,
      point_type: it.point_type as string,
      record_required: it.record_required as boolean,
      responsible: (it.responsible as string | null) ?? null,
      status: it.status as string,
      checked_by: checker?.full_name ?? null,
      checked_at: it.checked_at ? fmtDate(it.checked_at as string) : null,
    }
  })

  const buffer = await renderToBuffer(
    <ItpPdf
      itp={{
        number: itp.number as string,
        title: itp.title as string,
        activity: itp.activity as string,
        status: (itp.status as string) === 'active' ? 'Active' : 'Closed',
        project: project ? `${project.number} — ${project.name}` : '—',
        adoptedAt: fmtDate(itp.adopted_at as string),
        adoptedBy: adopter?.full_name ?? null,
        lotCount: (lotCountRows ?? []).length,
      }}
      company={toCompany(settings)}
      items={pdfItems}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${itp.number}.pdf"`,
    },
  })
}

async function lotPdf(id: string): Promise<Response> {
  const supabase = await createClient()

  const { data: lot } = await supabase
    .from('lots')
    .select(
      `number, description, location, status, opened_on, closed_at,
       itp_instance_id,
       projects(number, name),
       itp_instances(number, title),
       closer:profiles!lots_closed_by_fkey(full_name)`
    )
    .eq('id', id)
    .single()

  if (!lot) return new Response('Not found', { status: 404 })

  const [
    { data: items },
    { data: inspections },
    { data: tests },
    { data: holdPoints },
    { data: verdict },
    { data: attachmentRows },
    { data: settings },
  ] = await Promise.all([
    supabase
      .from('itp_instance_items')
      .select('id, position, description, acceptance_criteria, spec_ref, point_type, status')
      .eq('instance_id', lot.itp_instance_id as string)
      .order('position'),
    supabase
      .from('lot_inspections')
      .select(
        `itp_instance_item_id, result, inspected_at, ncr_id,
         inspector:profiles!lot_inspections_inspected_by_fkey(full_name),
         ncrs(number)`
      )
      .eq('lot_id', id)
      .order('inspected_at', { ascending: false }),
    supabase
      .from('lot_test_results')
      .select(
        'test_type, description, value, uom, spec_min, spec_max, pass, lab_ref, tested_on, ncrs(number)'
      )
      .eq('lot_id', id)
      .order('created_at'),
    supabase
      .from('hold_points')
      .select('title, required_by, status, released_at, released_by, release_ref')
      .eq('lot_id', id)
      .order('created_at'),
    supabase.rpc('lot_conformance', { p_lot: id }),
    supabase.from('attachments').select('id').eq('parent_type', 'lot').eq('parent_id', id),
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])

  const project = lot.projects as unknown as { number: string; name: string } | null
  const instance = lot.itp_instances as unknown as {
    number: string
    title: string
  } | null
  const closer = lot.closer as unknown as { full_name: string } | null

  // Latest inspection per item (query is newest-first) — plus the newest
  // inspection with a linked NCR so the disposition stays on the report after
  // a passing re-inspection.
  type LotInspRow = NonNullable<typeof inspections>[number]
  const latestByItem = new Map<string, LotInspRow>()
  const latestNcrByItem = new Map<string, LotInspRow>()
  for (const insp of inspections ?? []) {
    const key = insp.itp_instance_item_id as string
    if (!latestByItem.has(key)) latestByItem.set(key, insp)
    if (insp.ncr_id && !latestNcrByItem.has(key)) latestNcrByItem.set(key, insp)
  }

  const TEST_LABEL: Record<string, string> = {
    compaction: 'Compaction',
    concrete_strength: 'Concrete strength',
    survey_conformance: 'Survey conformance',
    environmental_validation: 'Environmental validation',
    other: 'Other',
  }

  const pdfItems: LotPdfItem[] = (items ?? []).map((it) => {
    const latest = latestByItem.get(it.id as string)
    const inspector = latest?.inspector as unknown as { full_name: string } | null
    const ncr = latestNcrByItem.get(it.id as string)?.ncrs as unknown as {
      number: string
    } | null
    return {
      position: it.position as number,
      description: it.description as string,
      acceptance_criteria: it.acceptance_criteria as string,
      spec_ref: (it.spec_ref as string | null) ?? null,
      point_type: it.point_type as string,
      item_status: it.status as string,
      result: (latest?.result as string | undefined) ?? null,
      inspected_by: inspector?.full_name ?? null,
      inspected_at: latest?.inspected_at
        ? fmtDate(latest.inspected_at as string)
        : null,
      ncr_number: ncr?.number ?? null,
    }
  })

  const pdfTests: LotPdfTest[] = (tests ?? []).map((t) => {
    const ncr = t.ncrs as unknown as { number: string } | null
    const value =
      t.value !== null && t.value !== undefined
        ? `${Number(t.value)}${t.uom ? ` ${t.uom}` : ''}`
        : null
    const spec =
      t.spec_min !== null || t.spec_max !== null
        ? `${t.spec_min !== null ? Number(t.spec_min) : '—'} to ${t.spec_max !== null ? Number(t.spec_max) : '—'}`
        : null
    return {
      test_type: TEST_LABEL[t.test_type as string] ?? (t.test_type as string),
      description: t.description as string,
      value,
      spec,
      pass: t.pass as boolean,
      lab_ref: (t.lab_ref as string | null) ?? null,
      tested_on: t.tested_on ? fmtDate(t.tested_on as string) : null,
      ncr_number: ncr?.number ?? null,
    }
  })

  const pdfHoldPoints: LotPdfHoldPoint[] = (holdPoints ?? []).map((hp) => ({
    title: hp.title as string,
    required_by: hp.required_by as string,
    status: hp.status as string,
    released_at: hp.released_at ? fmtDate(hp.released_at as string) : null,
    released_by: (hp.released_by as string | null) ?? null,
    release_ref: (hp.release_ref as string | null) ?? null,
  }))

  const ncrNumbers = [
    ...new Set([
      ...(inspections ?? [])
        .map((i) => (i.ncrs as unknown as { number: string } | null)?.number)
        .filter((n): n is string => Boolean(n)),
      ...(tests ?? [])
        .map((t) => (t.ncrs as unknown as { number: string } | null)?.number)
        .filter((n): n is string => Boolean(n)),
    ]),
  ]

  const buffer = await renderToBuffer(
    <LotPdf
      lot={{
        number: lot.number as string,
        description: lot.description as string,
        location: (lot.location as string | null) ?? null,
        project: project ? `${project.number} — ${project.name}` : '—',
        itp: instance ? `${instance.number} — ${instance.title}` : '—',
        status: lot.status as string,
        conformance: (verdict as string | null) ?? 'open',
        openedOn: fmtDate(lot.opened_on as string),
        closedAt: lot.closed_at ? fmtDate(lot.closed_at as string) : null,
        closedBy: closer?.full_name ?? null,
        ncrNumbers,
        attachmentCount: (attachmentRows ?? []).length,
      }}
      company={toCompany(settings)}
      items={pdfItems}
      tests={pdfTests}
      holdPoints={pdfHoldPoints}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${lot.number}-conformance.pdf"`,
    },
  })
}
