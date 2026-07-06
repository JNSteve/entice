import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aud, fmtDate } from '@/lib/format'
import { docTotals } from '@/lib/money'
import { todayAU } from '@/lib/tz'
import { isClientLinkActive, PROPERTY_COMPLIANCE_KIND_LABELS, type PropertyComplianceKind } from '@/lib/portal'
import { HANDOVER_ELIGIBLE_JOB_STATUSES, HANDOVER_ELIGIBLE_PROJECT_STATUSES, handoverEligible, type HandoverKind } from '@/lib/feedback'
import {
  HandoverPdf,
  type HandoverBillingRow,
  type HandoverComplianceRow,
  type HandoverDocumentRow,
  type HandoverHoldPointRow,
  type HandoverLotRow,
  type HandoverPdfRow,
  type HandoverWasteRow,
} from '@/pdf/HandoverPdf'
import type { DocCompany } from '@/pdf/DocShell'
import { WASTE_CLASSIFICATION_LABELS, type WasteClassification } from '@/lib/zod'

/**
 * Shared Handover Pack builder used by BOTH the office PDF route
 * (/api/pdf/handover/[id]?kind=job|project — preview/download) and the
 * generateHandoverPack server action (which stores the rendered pack as a
 * job/project attachment for portal publication via client_visible).
 *
 * ONE PDF, no zip: every referenced document is listed with name + date,
 * never embedded — the portal file gate serves the actual files.
 */

export type HandoverBuildResult =
  | { ok: true; buffer: Buffer; filename: string; number: string }
  | { ok: false; error: string; status: number }

/** Union row shape for the job/project query (fields per kind are optional). */
type WorkRow = {
  id: string
  number: string
  title?: string | null
  name?: string | null
  description: string | null
  status: string
  scheduled_start?: string | null
  scheduled_end?: string | null
  completed_at?: string | null
  start_date?: string | null
  practical_completion_date?: string | null
  site_id: string | null
  client_id: string
  clients: { name: string } | null
  sites: {
    id: string
    name: string
    address: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
  } | null
}

const LOT_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  conforming: 'Conforming',
  nonconforming: 'Nonconforming',
  closed: 'Closed (conforming)',
}

const HOLD_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  notified: 'Notified',
  released: 'Released',
}

export async function buildHandoverPack(
  supabase: SupabaseClient,
  kind: HandoverKind,
  id: string
): Promise<HandoverBuildResult> {
  if (kind !== 'job' && kind !== 'project') {
    return { ok: false, error: 'Unknown handover kind', status: 400 }
  }

  // ── Load the work + its property ─────────────────────────────────────────
  const workQuery =
    kind === 'job'
      ? supabase
          .from('jobs')
          .select(
            `id, number, title, description, status, scheduled_start,
             scheduled_end, completed_at, site_id, client_id,
             clients(name), sites(id, name, address, suburb, state, postcode)`
          )
          .eq('id', id)
          .single()
      : supabase
          .from('projects')
          .select(
            `id, number, name, description, status, start_date,
             practical_completion_date, site_id, client_id,
             clients(name), sites(id, name, address, suburb, state, postcode)`
          )
          .eq('id', id)
          .single()

  const [{ data: workRaw }, { data: settings }] = await Promise.all([
    workQuery,
    supabase
      .from('settings')
      .select('company_name, abn, address, phone, email, logo_path')
      .eq('id', 1)
      .single(),
  ])
  if (!workRaw) return { ok: false, error: 'Not found', status: 404 }
  const work = workRaw as unknown as WorkRow

  if (!handoverEligible(kind, work.status as string)) {
    const expected =
      kind === 'job'
        ? HANDOVER_ELIGIBLE_JOB_STATUSES.join('/')
        : HANDOVER_ELIGIBLE_PROJECT_STATUSES.join('/')
    return {
      ok: false,
      error: `Handover packs are generated for completed works only (${kind} must be ${expected}; this one is ${work.status}).`,
      status: 409,
    }
  }

  const site = work.sites as unknown as {
    id: string
    name: string
    address: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
  } | null
  const clientName =
    (work.clients as unknown as { name: string } | null)?.name ?? '—'
  const number = work.number as string
  const title = (kind === 'job' ? work.title : work.name) as string

  // ── Parallel evidence fetches ─────────────────────────────────────────────
  const [
    { data: complianceItems },
    { data: wasteLoads },
    { data: sharedAttachments },
    { data: clientLinks },
    lotsResult,
  ] = await Promise.all([
    site
      ? supabase
          .from('property_compliance_items')
          .select('kind, title, issue_date, review_due, evidence_filename, documents(filename)')
          .eq('site_id', site.id)
          .eq('status', 'active')
          .order('kind')
          .order('issue_date', { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from('waste_loads')
      .select('number, date, classification, classification_detail, qty, unit, docket_ref, env_facilities(name)')
      .eq(kind === 'job' ? 'job_id' : 'project_id', id)
      .order('date'),
    supabase
      .from('attachments')
      .select('filename, kind, caption, created_at')
      .eq('parent_type', kind)
      .eq('parent_id', id)
      .eq('client_visible', true)
      .order('created_at'),
    supabase
      .from('client_links')
      .select('revoked_at, expires_at, show_financials')
      .eq('client_id', work.client_id as string),
    kind === 'project'
      ? supabase
          .from('lots')
          .select('id, number, description, status')
          .eq('project_id', id)
          .order('number')
      : Promise.resolve({ data: [] as { id: string; number: string; description: string; status: string }[] }),
  ])

  // Quality hold points (lot-anchored clearance releases) — projects only.
  const lotRows = (lotsResult.data ?? []) as {
    id: string
    number: string
    description: string
    status: string
  }[]
  let holdPoints: HandoverHoldPointRow[] = []
  if (lotRows.length > 0) {
    const { data: hps } = await supabase
      .from('hold_points')
      .select('title, status, released_at, release_ref, lot_id')
      .eq('origin', 'quality')
      .in('lot_id', lotRows.map((l) => l.id))
      .order('date')
    const lotNumberById = new Map(lotRows.map((l) => [l.id, l.number]))
    holdPoints = (hps ?? []).map((hp) => ({
      lot: lotNumberById.get(hp.lot_id as string) ?? '—',
      title: hp.title as string,
      status: HOLD_STATUS_LABELS[hp.status as string] ?? (hp.status as string),
      released: hp.released_at ? fmtDate(hp.released_at as string) : null,
      releaseRef: (hp.release_ref as string | null) ?? null,
    }))
  }

  // ── Billing summary (issued documents only) ───────────────────────────────
  // Amounts appear only when the client can already see money in the portal
  // (an ACTIVE link with show_financials) — the stored pack is link-agnostic,
  // so the gate is per client, not per link.
  const showAmounts = ((clientLinks ?? []) as {
    revoked_at: string | null
    expires_at: string | null
    show_financials: boolean
  }[]).some((l) => l.show_financials && isClientLinkActive(l))

  let billing: HandoverBillingRow[] = []
  if (kind === 'job') {
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, number, issue_date, status, gst_rate')
      .eq('job_id', id)
      .in('status', ['sent', 'paid'])
      .order('issue_date')
    const invoiceRows = invoices ?? []
    const amounts = new Map<string, number>()
    if (showAmounts && invoiceRows.length > 0) {
      const { data: lines } = await supabase
        .from('invoice_lines')
        .select('invoice_id, qty, unit_sell')
        .in('invoice_id', invoiceRows.map((i) => i.id))
      for (const inv of invoiceRows) {
        const invLines = (lines ?? []).filter((l) => l.invoice_id === inv.id)
        amounts.set(
          inv.id as string,
          docTotals(
            invLines.map((l) => ({ qty: Number(l.qty), unitSell: Number(l.unit_sell) })),
            Number(inv.gst_rate)
          ).total
        )
      }
    }
    billing = invoiceRows.map((inv) => ({
      number: `Invoice ${inv.number}`,
      date: fmtDate(inv.issue_date),
      status: inv.status === 'paid' ? 'Paid' : 'Issued',
      amount: amounts.has(inv.id as string)
        ? aud(amounts.get(inv.id as string)!)
        : null,
    }))
  } else {
    const { data: claims } = await supabase
      .from('claims')
      .select('number, reference_date, status, total_inc_gst')
      .eq('project_id', id)
      .in('status', ['submitted', 'certified', 'paid'])
      .order('number')
    billing = (claims ?? []).map((c) => ({
      number: `Payment claim ${c.number}`,
      date: fmtDate(c.reference_date),
      status: (c.status as string).charAt(0).toUpperCase() + (c.status as string).slice(1),
      amount:
        showAmounts && c.total_inc_gst != null ? aud(Number(c.total_inc_gst)) : null,
    }))
  }

  // ── Shape the sections ────────────────────────────────────────────────────
  const compliance: HandoverComplianceRow[] = (complianceItems ?? []).map((i) => ({
    kind:
      PROPERTY_COMPLIANCE_KIND_LABELS[i.kind as PropertyComplianceKind] ??
      (i.kind as string),
    title: i.title as string,
    issued: fmtDate(i.issue_date as string),
    reviewDue: i.review_due ? fmtDate(i.review_due as string) : null,
    evidence:
      (i.evidence_filename as string | null) ??
      (i.documents as unknown as { filename: string | null } | null)?.filename ??
      null,
  }))

  const waste: HandoverWasteRow[] = (wasteLoads ?? []).map((w) => ({
    number: w.number as string,
    date: fmtDate(w.date as string),
    classification: `${
      WASTE_CLASSIFICATION_LABELS[w.classification as WasteClassification] ??
      (w.classification as string)
    }${w.classification_detail ? ` — ${w.classification_detail}` : ''}`,
    qty: `${Number(w.qty)} ${w.unit}`,
    facility: (w.env_facilities as unknown as { name: string } | null)?.name ?? null,
    docket: (w.docket_ref as string | null) ?? null,
  }))

  // The documents index lists client-shared evidence; earlier generated packs
  // are excluded (the pack should not index itself).
  const documents: HandoverDocumentRow[] = [
    ...((sharedAttachments ?? []) as {
      filename: string
      kind: string
      caption: string | null
      created_at: string
    }[])
      .filter((a) => a.caption !== 'Handover pack')
      .map((a) => ({
        name: a.filename,
        context: a.kind === 'photo' ? 'Photo (shared to portal)' : 'Shared to portal',
        date: fmtDate(a.created_at),
      })),
    ...compliance
      .filter((c) => c.evidence)
      .map((c) => ({
        name: c.evidence as string,
        context: `Compliance — ${c.kind}`,
        date: c.issued,
      })),
  ]

  const dates: HandoverPdfRow[] =
    kind === 'job'
      ? [
          ...(work.scheduled_start || work.scheduled_end
            ? [
                {
                  label: 'Scheduled',
                  value: [
                    work.scheduled_start ? fmtDate(work.scheduled_start as string) : null,
                    work.scheduled_end ? `to ${fmtDate(work.scheduled_end as string)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' '),
                },
              ]
            : []),
          ...(work.completed_at
            ? [{ label: 'Completed', value: fmtDate(work.completed_at as string) }]
            : []),
        ]
      : [
          ...(work.start_date
            ? [{ label: 'Started', value: fmtDate(work.start_date as string) }]
            : []),
          ...(work.practical_completion_date
            ? [
                {
                  label: 'Practical completion',
                  value: fmtDate(work.practical_completion_date as string),
                },
              ]
            : []),
        ]

  const siteAddress =
    site
      ? [site.address, [site.suburb, site.state, site.postcode].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ') || null
      : null

  const buffer = await renderToBuffer(
    <HandoverPdf
      company={toDocCompany(settings)}
      pack={{
        number,
        title,
        kindLabel: kind === 'job' ? 'Job' : 'Project',
        clientName,
        propertyName: site?.name ?? null,
        propertyAddress: siteAddress,
        description: (work.description as string | null) ?? null,
        dates,
        generatedDate: fmtDate(todayAU()),
      }}
      compliance={compliance}
      holdPoints={holdPoints}
      lots={lotRows.map<HandoverLotRow>((l) => ({
        number: l.number,
        description: l.description,
        status: LOT_STATUS_LABELS[l.status] ?? l.status,
      }))}
      waste={waste}
      documents={documents}
      billing={billing}
      showAmounts={showAmounts}
    />
  )

  return {
    ok: true,
    buffer: Buffer.from(buffer),
    filename: `handover-pack-${number}.pdf`,
    number,
  }
}

export async function buildHandoverPdfResponse(
  supabase: SupabaseClient,
  kind: string,
  id: string
): Promise<Response> {
  const result = await buildHandoverPack(supabase, kind as HandoverKind, id)
  if (!result.ok) {
    return new Response(result.error, { status: result.status })
  }
  return new Response(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${result.filename}"`,
    },
  })
}

// ─── Local settings → DocCompany (same shape as the PDF route) ───────────────

type SettingsRow = {
  company_name: string
  abn: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_path: string | null
}

// react-pdf's <Image> can only decode PNG/JPEG.
const LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg']

function resolveLogo(logoPath: string | null): string | undefined {
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

function toDocCompany(settings: SettingsRow | null): DocCompany {
  return {
    name: settings?.company_name ?? 'Company',
    abn: settings?.abn,
    address: settings?.address,
    phone: settings?.phone,
    email: settings?.email,
    logoUrl: resolveLogo(settings?.logo_path ?? null),
  }
}
