// src/lib/xero/push.ts
import { docTotals } from '@/lib/money'
import { XeroApiError, xeroApiForAdmin } from './client'
import { ensureContactForClient } from './contacts'
import { buildClaimPayload, buildInvoicePayload, claimInvoiceNumber, totalsDiffer } from './map'
import { loadMapping } from './mapping'
import { finishRun, logEvent, startRun, type Admin } from './register'
import { ensureTrackingOption } from './tracking'
import type { XeroInvoice, XeroInvoicePayload } from './types'

export type PushResult =
  | { ok: true; warnings: string[]; emailed: boolean }
  | { ok: false; error: string }

type OnlineInvoiceResponse = { OnlineInvoices?: { OnlineInvoiceUrl?: string }[] }

/**
 * Shared push core (spec §5.2 steps 4–7). Idempotent: looks the invoice up by
 * number before creating, so a retry after a timeout adopts the existing one.
 * Email is attempted once (callers pass `alreadyEmailed`).
 */
async function pushPayload(
  admin: Admin,
  api: ReturnType<typeof xeroApiForAdmin>,
  runId: string,
  entity: 'invoice' | 'claim',
  entityId: string,
  payload: XeroInvoicePayload,
  opts: { knownXeroId: string | null; alreadyEmailed: boolean; emailMode: 'xero' | 'ecr'; ecrTotal: number }
): Promise<{ xero: XeroInvoice; onlineUrl: string | null; emailed: boolean; warnings: string[] }> {
  const warnings: string[] = []

  let xero: XeroInvoice | null = null
  if (opts.knownXeroId) {
    const { Invoices = [] } = await api.get<{ Invoices?: XeroInvoice[] }>(`/Invoices/${opts.knownXeroId}`)
    xero = Invoices[0] ?? null
  }
  if (!xero) {
    const { Invoices = [] } = await api.get<{ Invoices?: XeroInvoice[] }>(
      `/Invoices?InvoiceNumbers=${encodeURIComponent(payload.InvoiceNumber)}`
    )
    xero = Invoices.find((i) => i.Status !== 'DELETED' && i.Status !== 'VOIDED') ?? null
    if (xero) {
      await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'matched', detail: `Adopted existing Xero invoice ${payload.InvoiceNumber}` })
    }
  }
  if (!xero) {
    const created = await api.post<{ Invoices: XeroInvoice[] }>('/Invoices', { Invoices: [payload] })
    xero = created.Invoices[0]
    await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'created', detail: `${payload.InvoiceNumber} → Xero` })
  }

  if (totalsDiffer(opts.ecrTotal, xero.Total)) {
    const w = `Xero total ${xero.Total?.toFixed(2)} differs from ECR total ${opts.ecrTotal.toFixed(2)} (GST rounding).`
    warnings.push(w)
    await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'warning', detail: w })
  }

  let onlineUrl: string | null = null
  try {
    const res = await api.get<OnlineInvoiceResponse>(`/Invoices/${xero.InvoiceID}/OnlineInvoice`)
    onlineUrl = res.OnlineInvoices?.[0]?.OnlineInvoiceUrl ?? null
  } catch (err) {
    warnings.push(`Pay-now link unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }

  let emailed = opts.alreadyEmailed
  if (!emailed && opts.emailMode === 'xero') {
    try {
      await api.postNoContent(`/Invoices/${xero.InvoiceID}/Email`)
      emailed = true
    } catch (err) {
      const w = `Xero could not email the invoice: ${err instanceof XeroApiError ? err.message : String(err)}. Add an email to the contact in Xero, or send ECR's PDF.`
      warnings.push(w)
      await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'warning', detail: w })
    }
  }

  return { xero, onlineUrl, emailed, warnings }
}

export async function pushInvoiceToXero(admin: Admin, invoiceId: string, actorId: string | null): Promise<PushResult> {
  const runId = await startRun(admin, 'push', actorId)
  try {
    const [{ data: inv }, { data: lines }, mapping] = await Promise.all([
      admin
        .from('invoices')
        .select('id, number, status, issue_date, due_date, gst_rate, client_id, job_id, xero_invoice_id, xero_emailed_at, clients(payment_terms_days), jobs(id, number, title)')
        .eq('id', invoiceId)
        .single(),
      admin.from('invoice_lines').select('description, qty, unit_sell, kind').eq('invoice_id', invoiceId).order('position'),
      loadMapping(admin),
    ])
    if (!inv) return { ok: false, error: 'Invoice not found' }
    const client = inv.clients as unknown as { payment_terms_days: number | null } | null
    const job = inv.jobs as unknown as { id: string; number: string; title: string } | null

    const api = xeroApiForAdmin(admin)
    const contactId = await ensureContactForClient(admin, api, runId, inv.client_id as string)
    const tracking = job ? await ensureTrackingOption(admin, api, runId, { kind: 'job', id: job.id, number: job.number }) : null

    const ecrLines = (lines ?? []).map((l) => ({
      description: l.description as string,
      qty: Number(l.qty),
      unit_sell: Number(l.unit_sell),
      kind: (l.kind as string | null) ?? null,
    }))
    const payload = buildInvoicePayload(
      {
        number: inv.number as string,
        issue_date: inv.issue_date as string,
        due_date: (inv.due_date as string | null) ?? null,
        gst_rate: Number(inv.gst_rate),
        payment_terms_days: client?.payment_terms_days ?? 30,
        job_number: job?.number ?? null,
        job_title: job?.title ?? null,
        lines: ecrLines,
      },
      mapping,
      contactId,
      tracking
    )
    const { total } = docTotals(ecrLines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })), Number(inv.gst_rate))

    const r = await pushPayload(admin, api, runId, 'invoice', invoiceId, payload, {
      knownXeroId: (inv.xero_invoice_id as string | null) ?? null,
      alreadyEmailed: Boolean(inv.xero_emailed_at),
      emailMode: mapping.emailMode,
      ecrTotal: total,
    })

    const { error } = await admin
      .from('invoices')
      .update({
        xero_invoice_id: r.xero.InvoiceID,
        xero_number: r.xero.InvoiceNumber ?? null,
        xero_status: r.xero.Status,
        xero_total: r.xero.Total ?? null,
        xero_amount_paid: r.xero.AmountPaid ?? 0,
        xero_amount_credited: r.xero.AmountCredited ?? 0,
        xero_amount_due: r.xero.AmountDue ?? r.xero.Total ?? null,
        xero_online_url: r.onlineUrl,
        xero_pushed_at: new Date().toISOString(),
        xero_emailed_at: r.emailed ? (inv.xero_emailed_at ?? new Date().toISOString()) : null,
        xero_synced_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
    if (error) throw new Error(`Xero invoice created but ECR could not record it: ${error.message}`)

    await finishRun(admin, runId, { status: r.warnings.length ? 'partial' : 'success', pushed: 1, warnings: r.warnings.length })
    return { ok: true, warnings: r.warnings, emailed: r.emailed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logEvent(admin, runId, { direction: 'push', entity: 'invoice', entityId: invoiceId, action: 'failed', detail: message })
    await finishRun(admin, runId, { status: 'failed', errors: 1, error: message })
    return { ok: false, error: message }
  }
}

export async function pushClaimToXero(admin: Admin, claimId: string, actorId: string | null): Promise<PushResult> {
  const runId = await startRun(admin, 'push', actorId)
  try {
    const [{ data: claim }, mapping] = await Promise.all([
      admin
        .from('claims')
        .select('id, number, status, reference_date, certified_amount, xero_invoice_id, projects(id, number, name, client_id, clients(payment_terms_days))')
        .eq('id', claimId)
        .single(),
      loadMapping(admin),
    ])
    if (!claim) return { ok: false, error: 'Claim not found' }
    if (claim.certified_amount == null) return { ok: false, error: 'Claim has no certified amount' }
    const project = claim.projects as unknown as {
      id: string; number: string; name: string; client_id: string
      clients: { payment_terms_days: number | null } | null
    }

    const api = xeroApiForAdmin(admin)
    const contactId = await ensureContactForClient(admin, api, runId, project.client_id)
    const tracking = await ensureTrackingOption(admin, api, runId, { kind: 'project', id: project.id, number: project.number })
    const certified = Number(claim.certified_amount)
    const payload = buildClaimPayload(
      {
        project_number: project.number,
        project_name: project.name,
        claim_number: Number(claim.number),
        certified_amount: certified,
        reference_date: claim.reference_date as string,
        payment_terms_days: project.clients?.payment_terms_days ?? 30,
      },
      mapping,
      contactId,
      tracking
    )

    const r = await pushPayload(admin, api, runId, 'claim', claimId, payload, {
      knownXeroId: (claim.xero_invoice_id as string | null) ?? null,
      alreadyEmailed: false,
      emailMode: mapping.emailMode,
      ecrTotal: certified,
    })

    const { error } = await admin
      .from('claims')
      .update({
        xero_invoice_id: r.xero.InvoiceID,
        xero_status: r.xero.Status,
        xero_amount_due: r.xero.AmountDue ?? r.xero.Total ?? null,
        xero_online_url: r.onlineUrl,
        xero_pushed_at: new Date().toISOString(),
        xero_synced_at: new Date().toISOString(),
      })
      .eq('id', claimId)
    if (error) throw new Error(`Xero invoice created but ECR could not record it: ${error.message}`)

    await finishRun(admin, runId, { status: r.warnings.length ? 'partial' : 'success', pushed: 1, warnings: r.warnings.length })
    return { ok: true, warnings: r.warnings, emailed: r.emailed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logEvent(admin, runId, { direction: 'push', entity: 'claim', entityId: claimId, action: 'failed', detail: message })
    await finishRun(admin, runId, { status: 'failed', errors: 1, error: message })
    return { ok: false, error: message }
  }
}

export { claimInvoiceNumber }
