// src/lib/xero/pull.ts
import { syncJobStatus } from '@/lib/job-status'
import { XeroRateLimitError, xeroApiForAdmin, type XeroApi } from './client'
import { syncContacts } from './contacts'
import {
  deriveInvoiceStatusFromXero,
  ifModifiedSinceHeader,
  parseXeroDate,
  parseXeroInstant,
  workNumberFromReference,
  xeroLinesToInvoiceLines,
} from './map'
import { finishRun, logEvent, runInProgress, startRun, type Admin } from './register'
import { syncReferenceData } from './reference'
import { loadConnection, getValidAccessToken } from './tokens'
import { archiveStaleTrackingOptions } from './tracking'
import type { XeroInvoice, XeroPayment } from './types'

export type SyncSummary = {
  skipped?: string
  runId?: string
  status?: 'success' | 'partial' | 'failed'
  invoices_pulled: number
  invoices_created: number
  payments_upserted: number
  contacts_linked: number
  warnings: number
  errors: number
}

const PAGE = 100
const FIRST_RUN_LOOKBACK_DAYS = 365
const OVERLAP_MS = 60 * 60 * 1000

function zero(): SyncSummary {
  return { invoices_pulled: 0, invoices_created: 0, payments_upserted: 0, contacts_linked: 0, warnings: 0, errors: 0 }
}

async function* pages<T>(api: XeroApi, base: string, key: string, since: string | null): AsyncGenerator<T[]> {
  for (let page = 1; ; page++) {
    const sep = base.includes('?') ? '&' : '?'
    const path = `${base}${sep}page=${page}`
    // If-Modified-Since is an HTTP header on the Xero API, never a query param
    // (client.ts get() takes { headers } as its second argument).
    const body = await api.get<Record<string, T[] | undefined>>(
      path,
      since ? { headers: { 'If-Modified-Since': ifModifiedSinceHeader(since) } } : undefined
    )
    const rows = body[key] ?? []
    yield rows
    if (rows.length < PAGE) return
  }
}

/**
 * Nightly / on-demand pull (spec §5.4). Never deletes ECR rows except payments
 * the sync itself created (source='xero') that Xero has since deleted. Only
 * touches Xero-owned columns + status on linked records.
 */
export async function runXeroSync(
  admin: Admin,
  opts: { trigger: 'cron' | 'manual'; createdBy?: string | null }
): Promise<SyncSummary> {
  const conn = await loadConnection(admin)
  if (!conn || conn.status !== 'connected' || !conn.refresh_token_enc) {
    return { ...zero(), skipped: conn?.status === 'needs_reconnect' ? 'Xero needs reconnecting' : 'Xero not connected' }
  }
  if (await runInProgress(admin)) return { ...zero(), skipped: 'A sync is already running' }

  const runId = await startRun(admin, opts.trigger, opts.createdBy ?? null)
  const s: SyncSummary = { ...zero(), runId }
  const startedAt = new Date().toISOString()
  const since = conn.last_sync_at
    ? new Date(new Date(conn.last_sync_at).getTime() - OVERLAP_MS).toISOString()
    : new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const api = xeroApiForAdmin(admin)
  let status: 'success' | 'partial' | 'failed' = 'success'
  let fatal: string | null = null

  try {
    // 1. Token warm-up — refreshing here keeps the 60-day refresh token alive.
    await getValidAccessToken(admin, { forceRefresh: opts.trigger === 'cron' })

    // 2. Reference data + contacts.
    await syncReferenceData(admin, api, runId)
    const contacts = await syncContacts(admin, api, runId, conn.last_sync_at ? since : null)
    s.contacts_linked = contacts.linked

    // 3. Sales invoices changed since last sync.
    for await (const batch of pages<XeroInvoice>(
      api,
      `/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&Statuses=AUTHORISED,PAID,VOIDED`,
      'Invoices',
      since
    )) {
      for (const x of batch) {
        s.invoices_pulled++
        try {
          const outcome = await applyInvoice(admin, runId, x)
          if (outcome === 'created') s.invoices_created++
          if (outcome === 'warning') s.warnings++
        } catch (err) {
          s.errors++
          await logEvent(admin, runId, { direction: 'pull', entity: 'invoice', xeroId: x.InvoiceID, action: 'failed', detail: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    // 4. Payments on sales invoices.
    for await (const batch of pages<XeroPayment>(
      api,
      `/Payments?where=${encodeURIComponent('PaymentType=="ACCRECPAYMENT"')}`,
      'Payments',
      since
    )) {
      for (const p of batch) {
        try {
          if (await applyPayment(admin, runId, p)) s.payments_upserted++
        } catch (err) {
          s.errors++
          await logEvent(admin, runId, { direction: 'pull', entity: 'payment', xeroId: p.PaymentID, action: 'failed', detail: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    // 5. Tracking hygiene.
    await archiveStaleTrackingOptions(admin, api, runId)
  } catch (err) {
    fatal = err instanceof Error ? err.message : String(err)
    status = err instanceof XeroRateLimitError ? 'partial' : 'failed'
    s.errors++
    await logEvent(admin, runId, { direction: 'pull', entity: 'connection', action: 'failed', detail: fatal })
  }

  if (status === 'success' && (s.errors > 0 || s.warnings > 0)) status = 'partial'
  s.status = status

  await finishRun(admin, runId, {
    status,
    invoices_pulled: s.invoices_pulled,
    invoices_created: s.invoices_created,
    payments_upserted: s.payments_upserted,
    contacts_linked: s.contacts_linked,
    warnings: s.warnings,
    errors: s.errors,
    error: fatal,
  })
  // Only advance the watermark when the run got through the invoice/payment pages.
  await admin
    .from('xero_connection')
    .update({
      last_sync_at: status === 'failed' ? conn.last_sync_at : startedAt,
      last_sync_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  return s
}

// ─── Invoices ────────────────────────────────────────────────────────────────

type InvoiceOutcome = 'updated' | 'created' | 'skipped' | 'warning'

async function applyInvoice(admin: Admin, runId: string, x: XeroInvoice): Promise<InvoiceOutcome> {
  const now = new Date().toISOString()
  const xeroCols = {
    xero_status: x.Status,
    xero_total: x.Total ?? null,
    xero_amount_paid: x.AmountPaid ?? null,
    xero_amount_credited: x.AmountCredited ?? null,
    xero_amount_due: x.AmountDue ?? null,
    xero_synced_at: now,
  }

  // Known ECR invoice (pushed, or matched earlier)?
  const { data: known } = await admin
    .from('invoices')
    .select('id, status, job_id, number')
    .or(`xero_invoice_id.eq.${x.InvoiceID},number.eq.${JSON.stringify(x.InvoiceNumber ?? '')}`)
    .limit(1)
    .maybeSingle()

  if (known) {
    const derived = deriveInvoiceStatusFromXero(x)
    const statusChanged = known.status !== 'draft' && known.status !== derived.status
    const { error } = await admin
      .from('invoices')
      .update({
        ...xeroCols,
        xero_invoice_id: x.InvoiceID,
        xero_number: x.InvoiceNumber ?? null,
        ...(known.status !== 'draft' ? { status: derived.status, paid_at: derived.paid_at } : {}),
      })
      .eq('id', known.id)
    if (error) throw error
    if (statusChanged) {
      await syncJobStatus(admin, known.job_id as string | null)
      await logEvent(admin, runId, {
        direction: 'pull', entity: 'invoice', entityId: known.id as string, xeroId: x.InvoiceID,
        action: derived.status === 'void' ? 'voided' : 'updated', detail: `${known.number}: ${known.status} → ${derived.status}`,
      })
    }
    return 'updated'
  }

  // Known progress claim?
  const { data: claim } = await admin
    .from('claims')
    .select('id, status, project_id')
    .eq('xero_invoice_id', x.InvoiceID)
    .maybeSingle()
  if (claim) {
    const derived = deriveInvoiceStatusFromXero(x)
    const patch: Record<string, unknown> = {
      xero_status: x.Status, xero_amount_due: x.AmountDue ?? null, xero_synced_at: now,
    }
    if (derived.status === 'paid' && claim.status === 'certified') {
      patch.status = 'paid'
      patch.paid_at = derived.paid_at ?? now
      const { data: c } = await admin.from('claims').select('certified_amount, total_inc_gst').eq('id', claim.id).single()
      await admin.from('payments').insert({
        claim_id: claim.id, amount: Number(c?.certified_amount ?? c?.total_inc_gst ?? 0),
        date: (derived.paid_at ?? now).slice(0, 10), method: 'xero', reference: x.InvoiceNumber ?? null, source: 'xero',
      })
    }
    const { error } = await admin.from('claims').update(patch).eq('id', claim.id)
    if (error) throw error
    if (derived.status === 'void') {
      await logEvent(admin, runId, { direction: 'pull', entity: 'claim', entityId: claim.id as string, xeroId: x.InvoiceID, action: 'warning', detail: 'Voided in Xero — claim stays certified in ECR (no void state for claims)' })
      return 'warning'
    }
    return 'updated'
  }

  // Unknown → mirror (spec §5.4 step 3). Never mirror Xero drafts/deleted.
  if (x.Status === 'DRAFT' || x.Status === 'SUBMITTED' || x.Status === 'DELETED') return 'skipped'

  const contactId = x.Contact?.ContactID ?? null
  let clientId: string | null = null
  let needsReview = false
  if (contactId) {
    const { data: c } = await admin.from('clients').select('id').eq('xero_contact_id', contactId).maybeSingle()
    clientId = (c?.id as string | undefined) ?? null
  }
  if (!clientId) {
    // Create a client from name + ABN only (spec §3) and flag for review.
    const { data: cached } = contactId
      ? await admin.from('xero_contacts').select('name, abn').eq('contact_id', contactId).maybeSingle()
      : { data: null }
    const name = cached?.name ?? x.Contact?.Name ?? 'Unknown Xero contact'
    const { data: created, error } = await admin
      .from('clients')
      .insert({ name, abn: cached?.abn ?? null, type: 'other', xero_contact_id: contactId })
      .select('id')
      .single()
    if (error || !created) throw new Error(`Could not create client for Xero contact "${name}": ${error?.message}`)
    clientId = created.id as string
    needsReview = true
    await logEvent(admin, runId, { direction: 'pull', entity: 'contact', entityId: clientId, xeroId: contactId, action: 'created', detail: `Client "${name}" created from Xero — review` })
  }

  // Job match: tracking option → reference number.
  let jobId: string | null = null
  const optionIds = (x.LineItems ?? []).flatMap((l) => l.Tracking ?? []).map((t) => t.TrackingOptionID).filter(Boolean) as string[]
  if (optionIds.length > 0) {
    const { data: j } = await admin.from('jobs').select('id').in('xero_tracking_option_id', optionIds).eq('client_id', clientId).limit(1).maybeSingle()
    jobId = (j?.id as string | undefined) ?? null
  }
  if (!jobId) {
    const num = workNumberFromReference(x.Reference)
    if (num) {
      const { data: j } = await admin.from('jobs').select('id').eq('number', num).eq('client_id', clientId).maybeSingle()
      jobId = (j?.id as string | undefined) ?? null
    }
  }
  if (!jobId) needsReview = true

  const derived = deriveInvoiceStatusFromXero(x)
  let number = x.InvoiceNumber?.trim() || `XERO-${x.InvoiceID.slice(0, 8)}`
  const { data: clash } = await admin.from('invoices').select('id').eq('number', number).maybeSingle()
  if (clash) number = `${number} (Xero)` // VERIFY-1 fallback

  const { data: inv, error: invErr } = await admin
    .from('invoices')
    .insert({
      number,
      job_id: jobId,
      client_id: clientId,
      status: derived.status,
      issue_date: parseXeroDate(x.DateString ?? x.Date) ?? now.slice(0, 10),
      due_date: parseXeroDate(x.DueDateString ?? x.DueDate),
      gst_rate: 10,
      sent_at: parseXeroInstant(x.UpdatedDateUTC) ?? now,
      paid_at: derived.paid_at,
      origin: 'xero',
      xero_invoice_id: x.InvoiceID,
      xero_number: x.InvoiceNumber ?? null,
      needs_review: needsReview,
      ...xeroCols,
    })
    .select('id')
    .single()
  if (invErr || !inv) throw new Error(`Could not mirror ${number}: ${invErr?.message}`)

  const lines = xeroLinesToInvoiceLines(x.LineItems ?? []).map((l) => ({ ...l, invoice_id: inv.id }))
  if (lines.length > 0) {
    const { error } = await admin.from('invoice_lines').insert(lines)
    if (error) throw error
  }
  await syncJobStatus(admin, jobId)
  await logEvent(admin, runId, {
    direction: 'pull', entity: 'invoice', entityId: inv.id as string, xeroId: x.InvoiceID,
    action: jobId ? 'created' : 'unmatched',
    detail: jobId ? `Mirrored ${number} from Xero` : `Mirrored ${number} from Xero — needs matching to a job`,
  })
  return 'created'
}

// ─── Payments ────────────────────────────────────────────────────────────────

async function applyPayment(admin: Admin, runId: string, p: XeroPayment): Promise<boolean> {
  const xeroInvoiceId = p.Invoice?.InvoiceID
  if (!xeroInvoiceId) return false
  const { data: inv } = await admin.from('invoices').select('id').eq('xero_invoice_id', xeroInvoiceId).maybeSingle()
  if (!inv) return false // claims settle via the invoice status path

  if (p.Status === 'DELETED') {
    // Only rows the sync itself created may be removed (spec §5.4 step 4).
    const { count } = await admin.from('payments').delete({ count: 'exact' }).eq('xero_payment_id', p.PaymentID).eq('source', 'xero')
    if ((count ?? 0) > 0) {
      await logEvent(admin, runId, { direction: 'pull', entity: 'payment', entityId: inv.id as string, xeroId: p.PaymentID, action: 'voided', detail: 'Payment deleted in Xero' })
    }
    return (count ?? 0) > 0
  }

  const { error } = await admin.from('payments').upsert(
    {
      invoice_id: inv.id,
      xero_payment_id: p.PaymentID,
      source: 'xero',
      date: parseXeroDate(p.Date) ?? new Date().toISOString().slice(0, 10),
      amount: p.Amount ?? 0,
      method: 'xero',
      reference: p.Reference ?? null,
    },
    { onConflict: 'xero_payment_id' }
  )
  if (error) throw error
  return true
}
