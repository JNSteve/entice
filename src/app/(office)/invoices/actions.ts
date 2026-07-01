'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { addDays, format } from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { docTotals, round2 } from '@/lib/money'
import { nextNumber } from '@/lib/numbering'
import { nowAU } from '@/lib/tz'
import {
  invoiceBasisSchema,
  invoiceHeaderSchema,
  invoiceLineUpdateSchema,
  paymentSchema,
} from '@/lib/zod'
import type { SupabaseClient } from '@supabase/supabase-js'

type Result = { error?: string }

/** Job statuses from which invoicing is allowed (progress billing onwards). */
const INVOICEABLE_JOB_STATUSES = ['in_progress', 'completed', 'invoiced', 'paid']

function revalidateInvoice(invoiceId: string, jobId?: string | null) {
  revalidatePath('/money')
  revalidatePath(`/invoices/${invoiceId}`)
  if (jobId) {
    revalidatePath('/jobs')
    revalidatePath(`/jobs/${jobId}`)
  }
}

/**
 * Lines (and header dates) are only editable while the invoice is draft —
 * marking sent freezes the document.
 */
async function assertDraft(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<{ error?: string; job_id?: string | null }> {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, status, job_id')
    .eq('id', invoiceId)
    .single()

  if (error || !invoice) return { error: 'Invoice not found' }
  if (invoice.status !== 'draft') {
    return { error: `Invoice is ${invoice.status} and can no longer be edited` }
  }
  return { job_id: invoice.job_id }
}

/**
 * Server-side job status sync, called after every invoice status/payment
 * change. Reconciles the job's invoicing status against its non-void invoices
 * in BOTH directions:
 *   Forward:
 *     - any non-void invoice sent/paid + job completed  → job invoiced
 *     - ALL non-void invoices paid (and ≥1 exists)      → job paid
 *   Reversal (e.g. a settling payment is deleted, reverting paid→sent):
 *     - job 'paid' but NOT all non-void invoices paid    → back to invoiced
 *       (if ≥1 is issued) or completed (if none are issued)
 * Void invoices are ignored entirely. Only the invoicing lifecycle statuses
 * (completed → invoiced → paid) are touched; earlier statuses are left alone.
 */
async function syncJobStatus(
  supabase: SupabaseClient,
  jobId: string | null
): Promise<void> {
  if (!jobId) return

  const [{ data: job }, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('id, status').eq('id', jobId).single(),
    supabase
      .from('invoices')
      .select('status')
      .eq('job_id', jobId)
      .neq('status', 'void'),
  ])
  if (!job || !invoices || invoices.length === 0) return

  const allPaid = invoices.every((i) => i.status === 'paid')
  const anyIssued = invoices.some((i) => i.status === 'sent' || i.status === 'paid')

  // Reversal: a 'paid' job whose invoices are no longer all-paid drops back to
  // the correct prior invoicing state. Without this, deleting the settling
  // payment reverts the invoice to 'sent' but strands the job on 'paid'.
  if (job.status === 'paid' && !allPaid) {
    await supabase
      .from('jobs')
      .update({ status: anyIssued ? 'invoiced' : 'completed' })
      .eq('id', jobId)
    return
  }

  if (allPaid && ['completed', 'invoiced'].includes(job.status)) {
    await supabase.from('jobs').update({ status: 'paid' }).eq('id', jobId)
    return
  }

  if (anyIssued && job.status === 'completed') {
    await supabase.from('jobs').update({ status: 'invoiced' }).eq('id', jobId)
  }
}

// ─── Create from job ─────────────────────────────────────────────────────────

export async function createInvoiceFromJob(
  jobId: string,
  basis: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = invoiceBasisSchema.safeParse(basis)
  if (!parsed.success) return { error: 'Invalid invoice basis' }

  const supabase = await createClient()

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, status, client_id, quote_id')
    .eq('id', jobId)
    .single()
  if (jobErr || !job) return { error: 'Job not found' }
  if (!INVOICEABLE_JOB_STATUSES.includes(job.status)) {
    return { error: `Cannot invoice a ${job.status} job` }
  }

  // Build the lines for the chosen basis before touching the sequence.
  let lines: { description: string; qty: number; unit: string; unit_sell: number }[] = []

  if (parsed.data === 'quote') {
    if (!job.quote_id) return { error: 'Job has no linked quote' }

    const [{ data: quote }, { data: sections }, { data: quoteLines }] =
      await Promise.all([
        supabase
          .from('quotes')
          .select('id, status')
          .eq('id', job.quote_id)
          .single(),
        supabase
          .from('quote_sections')
          .select('id, position')
          .eq('quote_id', job.quote_id)
          .order('position')
          .order('id'),
        supabase
          .from('quote_lines')
          .select('section_id, position, description, qty, unit, unit_sell')
          .eq('quote_id', job.quote_id)
          .order('position')
          .order('id'),
      ])

    if (!quote || quote.status !== 'accepted') {
      return { error: 'Linked quote is not accepted' }
    }
    if (!quoteLines || quoteLines.length === 0) {
      return { error: 'Linked quote has no lines' }
    }

    // Flatten in document order: lines grouped by section position, orphans last.
    const sectionOrder = new Map((sections ?? []).map((s, i) => [s.id, i]))
    const ordered = [...quoteLines].sort((a, b) => {
      const sa = a.section_id != null ? sectionOrder.get(a.section_id) ?? Infinity : Infinity
      const sb = b.section_id != null ? sectionOrder.get(b.section_id) ?? Infinity : Infinity
      return sa - sb || a.position - b.position
    })

    lines = ordered.map((l) => ({
      description: l.description,
      qty: Number(l.qty),
      unit: l.unit,
      unit_sell: Number(l.unit_sell),
    }))
  } else if (parsed.data === 'costs') {
    const { data: costs } = await supabase
      .from('costs')
      .select('date, description, amount')
      .eq('parent_type', 'job')
      .eq('parent_id', jobId)
      .order('date')
      .order('created_at')

    // 0 markup — sell starts at cost amount, the user edits prices on the invoice.
    lines = (costs ?? []).map((c) => ({
      description: c.description,
      qty: 1,
      unit: 'ea',
      unit_sell: Number(c.amount),
    }))
  }

  const [{ data: client }, { data: settings }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, payment_terms_days')
      .eq('id', job.client_id)
      .single(),
    supabase.from('settings').select('gst_rate').eq('id', 1).single(),
  ])
  if (!client) return { error: 'Client not found' }

  const today = nowAU()
  const issueDate = format(today, 'yyyy-MM-dd')
  const dueDate = format(addDays(today, client.payment_terms_days ?? 30), 'yyyy-MM-dd')

  let number: string
  try {
    number = await nextNumber(supabase, 'invoice')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate invoice number' }
  }

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      number,
      job_id: jobId,
      client_id: job.client_id,
      status: 'draft',
      issue_date: issueDate,
      due_date: dueDate,
      gst_rate: settings?.gst_rate ?? 10,
    })
    .select('id')
    .single()
  if (invErr || !invoice) return { error: invErr?.message ?? 'Failed to create invoice' }

  if (lines.length > 0) {
    const { error: linesErr } = await supabase
      .from('invoice_lines')
      .insert(lines.map((l, i) => ({ ...l, invoice_id: invoice.id, position: i })))
    if (linesErr) return { error: linesErr.message }
  }

  revalidateInvoice(invoice.id, jobId)
  redirect(`/invoices/${invoice.id}`)
}

// ─── Header / status ─────────────────────────────────────────────────────────

export async function updateInvoiceHeader(
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = invoiceHeaderSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const draft = await assertDraft(supabase, id)
  if (draft.error) return { error: draft.error }

  const { error } = await supabase.from('invoices').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }

  revalidateInvoice(id, draft.job_id)
  return {}
}

export async function markInvoiceSent(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status, job_id')
    .eq('id', id)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (invoice.status !== 'draft') {
    return { error: `Can't mark a ${invoice.status} invoice as sent` }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  await syncJobStatus(supabase, invoice.job_id)

  revalidateInvoice(id, invoice.job_id)
  return {}
}

export async function voidInvoice(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status, job_id')
    .eq('id', id)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (!['draft', 'sent'].includes(invoice.status)) {
    return { error: `Can't void a ${invoice.status} invoice` }
  }

  // A part-paid invoice must not be voided — voiding excludes it from every
  // non-void rollup, orphaning the recorded cash and letting syncJobStatus
  // mis-flip the job. Payments are removable (see deletePayment), so this is
  // actionable: clear the payments first, then void.
  const { count: paymentCount, error: payCountErr } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', id)
  if (payCountErr) return { error: payCountErr.message }
  if ((paymentCount ?? 0) > 0) {
    return {
      error:
        'This invoice has recorded payments — remove the payments before voiding it.',
    }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void' })
    .eq('id', id)
  if (error) return { error: error.message }

  // Voiding can complete the "all non-void invoices paid" condition.
  await syncJobStatus(supabase, invoice.job_id)

  revalidateInvoice(id, invoice.job_id)
  return {}
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export async function addInvoiceLine(invoiceId: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const draft = await assertDraft(supabase, invoiceId)
  if (draft.error) return { error: draft.error }

  const { data: last } = await supabase
    .from('invoice_lines')
    .select('position')
    .eq('invoice_id', invoiceId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('invoice_lines').insert({
    invoice_id: invoiceId,
    position: (last?.position ?? -1) + 1,
    description: '',
    qty: 1,
    unit: 'ea',
    unit_sell: 0,
  })
  if (error) return { error: error.message }

  revalidateInvoice(invoiceId, draft.job_id)
  return {}
}

export async function updateInvoiceLine(id: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = invoiceLineUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('invoice_lines')
    .select('id, invoice_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const draft = await assertDraft(supabase, line.invoice_id)
  if (draft.error) return { error: draft.error }

  const { error } = await supabase
    .from('invoice_lines')
    .update(parsed.data)
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateInvoice(line.invoice_id, draft.job_id)
  return {}
}

export async function deleteInvoiceLine(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('invoice_lines')
    .select('id, invoice_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const draft = await assertDraft(supabase, line.invoice_id)
  if (draft.error) return { error: draft.error }

  const { error } = await supabase.from('invoice_lines').delete().eq('id', id)
  if (error) return { error: error.message }

  // Renormalise sibling positions to close the gap.
  const { data: siblings } = await supabase
    .from('invoice_lines')
    .select('id, position')
    .eq('invoice_id', line.invoice_id)
    .order('position')
    .order('id')
  const renumError = await renumberSiblings(siblings ?? [], async (rowId, position) => {
    const { error: e } = await supabase
      .from('invoice_lines')
      .update({ position })
      .eq('id', rowId)
    return e?.message
  })
  if (renumError) return { error: renumError }

  revalidateInvoice(line.invoice_id, draft.job_id)
  return {}
}

export async function moveInvoiceLine(id: string, dir: 'up' | 'down'): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('invoice_lines')
    .select('id, invoice_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const draft = await assertDraft(supabase, line.invoice_id)
  if (draft.error) return { error: draft.error }

  const { data: siblings, error: sibError } = await supabase
    .from('invoice_lines')
    .select('id, position')
    .eq('invoice_id', line.invoice_id)
    .order('position')
    .order('id')
  if (sibError || !siblings) return { error: sibError?.message ?? 'Failed to load lines' }

  const index = siblings.findIndex((r) => r.id === id)
  if (index === -1) return { error: 'Line not found' }
  const swapWith = dir === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= siblings.length) return {} // edge — no-op

  const next = [...siblings]
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]

  const renumError = await renumberSiblings(next, async (rowId, position) => {
    const { error: e } = await supabase
      .from('invoice_lines')
      .update({ position })
      .eq('id', rowId)
    return e?.message
  })
  if (renumError) return { error: renumError }

  revalidateInvoice(line.invoice_id, draft.job_id)
  return {}
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function recordPayment(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = paymentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  if (parsed.data.amount <= 0) {
    return { error: 'Payment amount must be greater than zero.' }
  }

  const supabase = await createClient()
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status, job_id, gst_rate')
    .eq('id', parsed.data.invoice_id)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (invoice.status !== 'sent') {
    return { error: `Payments can only be recorded on sent invoices (this one is ${invoice.status})` }
  }

  // Upper-bound guard: reject any payment that would push Σ payments over the
  // invoice total inc GST (exact equality is allowed — that settles it).
  const [{ data: priorLines }, { data: priorPayments }] = await Promise.all([
    supabase
      .from('invoice_lines')
      .select('qty, unit_sell')
      .eq('invoice_id', invoice.id),
    supabase.from('payments').select('amount').eq('invoice_id', invoice.id),
  ])

  const { total } = docTotals(
    (priorLines ?? []).map((l) => ({ qty: Number(l.qty), unitSell: Number(l.unit_sell) })),
    Number(invoice.gst_rate)
  )
  const alreadyPaid = round2((priorPayments ?? []).reduce((s, p) => s + Number(p.amount), 0))
  const remaining = round2(total - alreadyPaid)
  if (round2(alreadyPaid + parsed.data.amount) > total) {
    return { error: `Payment exceeds the outstanding balance of $${remaining.toFixed(2)}.` }
  }

  const { error: payErr } = await supabase.from('payments').insert({
    invoice_id: invoice.id,
    date: parsed.data.date,
    amount: parsed.data.amount,
    method: parsed.data.method,
    reference: parsed.data.reference ?? null,
  })
  if (payErr) return { error: payErr.message }

  // Server-side auto-paid check: Σ payments >= total inc GST.
  const paid = round2(alreadyPaid + parsed.data.amount)

  if (paid >= total) {
    const { error: updErr } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', invoice.id)
    if (updErr) return { error: updErr.message }

    await syncJobStatus(supabase, invoice.job_id)
  }

  revalidateInvoice(invoice.id, invoice.job_id)
  return {}
}

export async function deletePayment(paymentId: string): Promise<Result> {
  // Payments are only removable by admins. Deleting the payment that settled an
  // invoice reverts it from 'paid' back to 'sent' so overpayment typos and other
  // mistakes are recoverable.
  await requireRole('admin')

  const supabase = await createClient()
  const { data: payment } = await supabase
    .from('payments')
    .select('id, invoice_id')
    .eq('id', paymentId)
    .single()
  if (!payment || !payment.invoice_id) return { error: 'Payment not found' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, status, job_id, gst_rate')
    .eq('id', payment.invoice_id)
    .single()
  if (!invoice) return { error: 'Invoice not found' }

  const { error } = await supabase.from('payments').delete().eq('id', paymentId)
  if (error) return { error: error.message }

  // Recompute Σ payments; if a previously-paid invoice now falls below its total,
  // revert it to 'sent' (clear paid_at) and re-sync the job so it reverts too.
  if (invoice.status === 'paid') {
    const [{ data: lines }, { data: payments }] = await Promise.all([
      supabase
        .from('invoice_lines')
        .select('qty, unit_sell')
        .eq('invoice_id', invoice.id),
      supabase.from('payments').select('amount').eq('invoice_id', invoice.id),
    ])

    const { total } = docTotals(
      (lines ?? []).map((l) => ({ qty: Number(l.qty), unitSell: Number(l.unit_sell) })),
      Number(invoice.gst_rate)
    )
    const paid = round2((payments ?? []).reduce((s, p) => s + Number(p.amount), 0))

    if (paid < total) {
      const { error: updErr } = await supabase
        .from('invoices')
        .update({ status: 'sent', paid_at: null })
        .eq('id', invoice.id)
      if (updErr) return { error: updErr.message }

      await syncJobStatus(supabase, invoice.job_id)
    }
  }

  revalidateInvoice(invoice.id, invoice.job_id)
  return {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Rewrites sequential 0-based positions for rows whose position drifted. */
async function renumberSiblings(
  ordered: { id: string; position: number }[],
  write: (id: string, position: number) => Promise<string | undefined>
): Promise<string | undefined> {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].position !== i) {
      const error = await write(ordered[i].id, i)
      if (error) return error
    }
  }
  return undefined
}
