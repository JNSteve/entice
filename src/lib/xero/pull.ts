import { syncJobStatus } from '@/lib/job-status'
import { XeroRateLimitError, xeroApiForAdmin, type XeroApi } from './client'
import { syncContacts } from './contacts'
import {
  deriveInvoiceStatusFromXero,
  ifModifiedSinceHeader,
  mirrorLinesFromXero,
  parseXeroDate,
  parseXeroInstant,
  workNumberFromReference,
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
/** First connection pulls the last quarter; older history stays in Xero. */
const FIRST_RUN_LOOKBACK_DAYS = 90
const OVERLAP_MS = 60 * 60 * 1000
/** Wall-clock budget for one run, well inside the 300s route maxDuration. */
const RUN_BUDGET_MS = 240_000

function zero(): SyncSummary {
  return { invoices_pulled: 0, invoices_created: 0, payments_upserted: 0, contacts_linked: 0, warnings: 0, errors: 0 }
}

/** The paged list may omit or empty LineItems; fetch the full invoice when we need lines. */
async function withLines(api: XeroApi, x: XeroInvoice): Promise<XeroInvoice> {
  const emptyButValued = Array.isArray(x.LineItems) && x.LineItems.length === 0 && (x.SubTotal ?? x.Total ?? 0) > 0
  if (x.LineItems !== undefined && !emptyButValued) return x
  const { Invoices = [] } = await api.get<{ Invoices?: XeroInvoice[] }>(`/Invoices/${x.InvoiceID}`)
  return Invoices[0] ?? x
}

async function* pages<T>(api: XeroApi, base: string, key: string, since: string | null): AsyncGenerator<T[]> {
  for (let page = 1; ; page++) {
    const sep = base.includes('?') ? '&' : '?'
    const path = `${base}${sep}page=${page}&pageSize=${PAGE}`
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
  const deadline = Date.now() + RUN_BUDGET_MS
  const since = conn.last_sync_at
    ? new Date(new Date(conn.last_sync_at).getTime() - OVERLAP_MS).toISOString()
    : new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const api = xeroApiForAdmin(admin)
  let status: 'success' | 'partial' | 'failed' = 'success'
  let fatal: string | null = null
  let truncated = false
  let budgetLogged = false
  const logBudgetOnce = async () => {
    if (budgetLogged) return
    budgetLogged = true
    await logEvent(admin, runId, { direction: 'pull', entity: 'connection', action: 'warning', detail: 'Stopped at the time budget — resumes from the same watermark next run' })
  }

  try {
    // 1. Token warm-up — refreshing here keeps the 60-day refresh token alive.
    await getValidAccessToken(admin, { forceRefresh: opts.trigger === 'cron' })

    // 2. Reference data + contacts.
    await syncReferenceData(admin, api, runId)
    const contacts = await syncContacts(admin, api, runId, conn.last_sync_at ? since : null)
    s.contacts_linked = contacts.linked

    // 3. Sales invoices changed since last sync.
    invoicesLoop: for await (const batch of pages<XeroInvoice>(
      api,
      `/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&Statuses=AUTHORISED,PAID,VOIDED`,
      'Invoices',
      since
    )) {
      if (Date.now() > deadline) {
        truncated = true
        await logBudgetOnce()
        break
      }
      for (const x of batch) {
        if (Date.now() > deadline) {
          truncated = true
          await logBudgetOnce()
          break invoicesLoop
        }
        s.invoices_pulled++
        try {
          const outcome = await applyInvoice(admin, runId, api, x)
          if (outcome === 'created' || outcome === 'created_warning') s.invoices_created++
          if (outcome === 'warning' || outcome === 'created_warning') s.warnings++
        } catch (err) {
          s.errors++
          await logEvent(admin, runId, { direction: 'pull', entity: 'invoice', xeroId: x.InvoiceID, action: 'failed', detail: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    // 4. Payments on sales invoices.
    if (!truncated) {
      paymentsLoop: for await (const batch of pages<XeroPayment>(
        api,
        `/Payments?where=${encodeURIComponent('PaymentType=="ACCRECPAYMENT"')}`,
        'Payments',
        since
      )) {
        if (Date.now() > deadline) {
          truncated = true
          await logBudgetOnce()
          break
        }
        for (const p of batch) {
          if (Date.now() > deadline) {
            truncated = true
            await logBudgetOnce()
            break paymentsLoop
          }
          try {
            if (await applyPayment(admin, runId, p)) s.payments_upserted++
          } catch (err) {
            s.errors++
            await logEvent(admin, runId, { direction: 'pull', entity: 'payment', xeroId: p.PaymentID, action: 'failed', detail: err instanceof Error ? err.message : String(err) })
          }
        }
      }
    }

    // 5. Tracking hygiene.
    if (!truncated) await archiveStaleTrackingOptions(admin, api, runId)
  } catch (err) {
    fatal = err instanceof Error ? err.message : String(err)
    status = err instanceof XeroRateLimitError ? 'partial' : 'failed'
    truncated = true
    s.errors++
    await logEvent(admin, runId, { direction: 'pull', entity: 'connection', action: 'failed', detail: fatal })
  }

  if (status === 'success' && (s.errors > 0 || s.warnings > 0)) status = 'partial'
  // A run cut short by the time budget did real work but is not a full pass.
  if (truncated && status === 'success') status = 'partial'
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
  // Advance the watermark whenever the run reached the end of every page,
  // even if individual records warned or failed (those are in the register
  // and inside the 1-hour overlap on the next run). Hold it back only when
  // the run was truncated (rate limit or a fatal error) so nothing is skipped.
  await admin
    .from('xero_connection')
    .update({
      last_sync_at: truncated ? conn.last_sync_at : startedAt,
      last_sync_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  return s
}

// ─── Invoices ────────────────────────────────────────────────────────────────

type InvoiceOutcome = 'updated' | 'created' | 'created_warning' | 'skipped' | 'warning'

async function applyInvoice(
  admin: Admin,
  runId: string,
  api: XeroApi,
  x: XeroInvoice
): Promise<InvoiceOutcome> {
  const now = new Date().toISOString()
  const xeroCols = {
    xero_status: x.Status,
    xero_total: x.Total ?? null,
    xero_amount_paid: x.AmountPaid ?? null,
    xero_amount_credited: x.AmountCredited ?? null,
    xero_amount_due: x.AmountDue ?? null,
    xero_synced_at: now,
  }

  // Known ECR invoice (pushed, or matched by number)?
  const cols = 'id, status, job_id, number, origin, client_id, needs_review'
  let known = (await admin.from('invoices').select(cols).eq('xero_invoice_id', x.InvoiceID).maybeSingle()).data
  const xeroNumber = x.InvoiceNumber?.trim()
  if (!known && xeroNumber) {
    const { data: byNumber } = await admin
      .from('invoices')
      .select(`${cols}, clients(xero_contact_id)`)
      .eq('number', xeroNumber)
      .is('xero_invoice_id', null)
      .eq('origin', 'ecr')
      .in('status', ['sent', 'paid', 'void'])
      .maybeSingle()
    const linkedContact = (byNumber?.clients as unknown as { xero_contact_id: string | null } | null)?.xero_contact_id ?? null
    const contactAgrees = !linkedContact || !x.Contact?.ContactID || linkedContact === x.Contact.ContactID
    if (byNumber && contactAgrees) known = byNumber
  }

  if (known) {
    const derived = deriveInvoiceStatusFromXero(x)
    const statusChanged = known.status !== 'draft' && known.status !== derived.status
    const revertedToSent = known.status === 'paid' && derived.status === 'sent'
    const isXeroMirror = known.origin === 'xero'
    // A paged list can omit LineItems; re-mirroring off that would blank the
    // invoice, so fetch the full record and leave the lines alone if Xero
    // still gives us none.
    const full = isXeroMirror ? await withLines(api, x) : x
    const linesMissing = isXeroMirror && full.LineItems === undefined
    const m = isXeroMirror && !linesMissing ? mirrorLinesFromXero(full) : null
    const { error } = await admin
      .from('invoices')
      .update({
        ...xeroCols,
        xero_invoice_id: x.InvoiceID,
        xero_number: x.InvoiceNumber ?? null,
        ...(known.status !== 'draft' ? { status: derived.status, paid_at: derived.paid_at } : {}),
        ...(m ? { gst_rate: m.gst_rate, ...(m.reconciles ? {} : { needs_review: true }) } : {}),
      })
      .eq('id', known.id)
    if (error) throw error
    if (m) {
      const { error: delErr } = await admin.from('invoice_lines').delete().eq('invoice_id', known.id)
      if (delErr) throw delErr
      if (m.lines.length > 0) {
        const { error: linesErr } = await admin
          .from('invoice_lines')
          .insert(m.lines.map((l) => ({ ...l, invoice_id: known.id })))
        if (linesErr) {
          await admin.from('invoices').update({ needs_review: true }).eq('id', known.id)
          throw new Error(`Could not refresh lines for ${known.number}: ${linesErr.message}`)
        }
      }
      if (!m.reconciles) {
        await logEvent(admin, runId, {
          direction: 'pull', entity: 'invoice', entityId: known.id as string, xeroId: x.InvoiceID,
          action: 'warning', detail: 'ECR total does not reconcile with Xero Total',
        })
      }
    }
    if (linesMissing) {
      await logEvent(admin, runId, {
        direction: 'pull', entity: 'invoice', entityId: known.id as string, xeroId: x.InvoiceID,
        action: 'skipped', detail: 'Xero returned no line items — lines left as-is',
      })
    }
    if (statusChanged) {
      await syncJobStatus(admin, known.job_id as string | null)
      await logEvent(admin, runId, {
        direction: 'pull', entity: 'invoice', entityId: known.id as string, xeroId: x.InvoiceID,
        action: derived.status === 'void' ? 'voided' : 'updated', detail: `${known.number}: ${known.status} → ${derived.status}`,
      })
      if (revertedToSent) {
        await logEvent(admin, runId, {
          direction: 'pull', entity: 'invoice', entityId: known.id as string, xeroId: x.InvoiceID,
          action: 'warning', detail: 'Reverted to sent — Xero shows an amount due',
        })
      }
    }
    return 'updated'
  }

  // Known progress claim? Payment itself arrives separately via applyPayment.
  const { data: claim } = await admin
    .from('claims')
    .select('id, status')
    .eq('xero_invoice_id', x.InvoiceID)
    .maybeSingle()
  if (claim) {
    const derived = deriveInvoiceStatusFromXero(x)
    const patch: Record<string, unknown> = {
      xero_status: x.Status, xero_amount_due: x.AmountDue ?? null, xero_synced_at: now,
    }
    const justPaid = derived.status === 'paid' && claim.status === 'certified'
    if (justPaid) {
      patch.status = 'paid'
      patch.paid_at = derived.paid_at ?? now
    }
    const { error } = await admin.from('claims').update(patch).eq('id', claim.id)
    if (error) throw error
    if (justPaid) {
      await logEvent(admin, runId, { direction: 'pull', entity: 'claim', entityId: claim.id as string, xeroId: x.InvoiceID, action: 'updated', detail: 'Claim paid in Xero' })
    }
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

  // Lines drive both the job match and the mirror, and the paged list may omit
  // them — fetch the full invoice once here and read everything off that.
  const source = await withLines(api, x)

  // Job match: tracking option → reference number.
  let jobId: string | null = null
  const optionIds = (source.LineItems ?? []).flatMap((l) => l.Tracking ?? []).map((t) => t.TrackingOptionID).filter(Boolean) as string[]
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

  const m = mirrorLinesFromXero(source)
  const { data: inv, error: invErr } = await admin
    .from('invoices')
    .insert({
      number,
      job_id: jobId,
      client_id: clientId,
      status: derived.status,
      issue_date: parseXeroDate(x.DateString ?? x.Date) ?? now.slice(0, 10),
      due_date: parseXeroDate(x.DueDateString ?? x.DueDate),
      gst_rate: m.gst_rate,
      sent_at: parseXeroInstant(x.UpdatedDateUTC) ?? now,
      paid_at: derived.paid_at,
      origin: 'xero',
      xero_invoice_id: x.InvoiceID,
      xero_number: x.InvoiceNumber ?? null,
      needs_review: needsReview || !m.reconciles,
      ...xeroCols,
    })
    .select('id')
    .single()
  if (invErr || !inv) throw new Error(`Could not mirror ${number}: ${invErr?.message}`)

  const lines = m.lines.map((l) => ({ ...l, invoice_id: inv.id }))
  if (lines.length > 0) {
    const { error } = await admin.from('invoice_lines').insert(lines)
    if (error) {
      await admin.from('invoices').delete().eq('id', inv.id)
      throw new Error(`Could not mirror lines for ${number}: ${error.message}`)
    }
  }
  await syncJobStatus(admin, jobId)
  await logEvent(admin, runId, {
    direction: 'pull', entity: 'invoice', entityId: inv.id as string, xeroId: x.InvoiceID,
    action: jobId ? 'created' : 'unmatched',
    detail: jobId ? `Mirrored ${number} from Xero` : `Mirrored ${number} from Xero — needs matching to a job`,
  })
  if (!m.reconciles) {
    await logEvent(admin, runId, {
      direction: 'pull', entity: 'invoice', entityId: inv.id as string, xeroId: x.InvoiceID,
      action: 'warning', detail: 'ECR total does not reconcile with Xero Total — review',
    })
    // Counted as both a creation and a warning so the run ends 'partial' and
    // the dashboard alert fires.
    return 'created_warning'
  }
  return 'created'
}

// ─── Payments ────────────────────────────────────────────────────────────────

// Payments settle invoices AND pushed claims; claim status flips in applyInvoice.
async function applyPayment(admin: Admin, runId: string, p: XeroPayment): Promise<boolean> {
  const xeroInvoiceId = p.Invoice?.InvoiceID
  if (!xeroInvoiceId) return false
  const { data: inv } = await admin.from('invoices').select('id').eq('xero_invoice_id', xeroInvoiceId).maybeSingle()
  const { data: claim } = inv
    ? { data: null }
    : await admin.from('claims').select('id').eq('xero_invoice_id', xeroInvoiceId).maybeSingle()
  if (!inv && !claim) return false
  const targetId = (inv?.id ?? claim?.id) as string

  if (p.Status === 'DELETED') {
    // Only rows the sync itself created may be removed (spec §5.4 step 4).
    const { count } = await admin.from('payments').delete({ count: 'exact' }).eq('xero_payment_id', p.PaymentID).eq('source', 'xero')
    if ((count ?? 0) > 0) {
      await logEvent(admin, runId, { direction: 'pull', entity: 'payment', entityId: targetId, xeroId: p.PaymentID, action: 'voided', detail: 'Payment deleted in Xero' })
    }
    return (count ?? 0) > 0
  }

  const { error } = await admin.from('payments').upsert(
    {
      invoice_id: inv?.id ?? null,
      claim_id: claim?.id ?? null,
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
