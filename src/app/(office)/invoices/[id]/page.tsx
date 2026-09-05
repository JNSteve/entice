import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getXeroStatus } from '@/lib/xero/status'
import {
  InvoiceEditor,
  type InvoiceData,
  type InvoiceLineData,
  type PaymentData,
} from './invoice-editor'

// Xero pushes/syncs run inside actions invoked from this page.
export const maxDuration = 300

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: invoice }, { data: lines }, { data: payments }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select('*, clients(id, name), jobs(id, number, title)')
        .eq('id', id)
        .single(),
      supabase
        .from('invoice_lines')
        .select('id, position, description, qty, unit, unit_sell, kind')
        .eq('invoice_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('payments')
        .select('id, date, amount, method, reference, source')
        .eq('invoice_id', id)
        .order('date')
        .order('id'),
    ])

  const xero = await getXeroStatus()

  if (!invoice) notFound()

  const clientRel = invoice.clients as unknown as { id: string; name: string } | null
  const jobRel = invoice.jobs as unknown as {
    id: string
    number: string
    title: string
  } | null

  const invoiceData: InvoiceData = {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    gst_rate: Number(invoice.gst_rate),
    sent_at: invoice.sent_at,
    paid_at: invoice.paid_at,
    client_id: clientRel?.id ?? null,
    client_name: clientRel?.name ?? '—',
    job_id: jobRel?.id ?? null,
    job_number: jobRel?.number ?? null,
    job_title: jobRel?.title ?? null,
    origin: (invoice.origin as 'ecr' | 'xero') ?? 'ecr',
    needs_review: Boolean(invoice.needs_review),
    xero: invoice.xero_invoice_id
      ? {
          invoice_id: invoice.xero_invoice_id as string,
          number: (invoice.xero_number as string | null) ?? null,
          status: (invoice.xero_status as string | null) ?? null,
          total: invoice.xero_total != null ? Number(invoice.xero_total) : null,
          amount_paid: invoice.xero_amount_paid != null ? Number(invoice.xero_amount_paid) : null,
          amount_credited: invoice.xero_amount_credited != null ? Number(invoice.xero_amount_credited) : null,
          amount_due: invoice.xero_amount_due != null ? Number(invoice.xero_amount_due) : null,
          online_url: (invoice.xero_online_url as string | null) ?? null,
          pushed_at: (invoice.xero_pushed_at as string | null) ?? null,
          emailed_at: (invoice.xero_emailed_at as string | null) ?? null,
          synced_at: (invoice.xero_synced_at as string | null) ?? null,
        }
      : null,
  }

  const lineData: InvoiceLineData[] = (lines ?? []).map((l) => ({
    id: l.id,
    position: l.position,
    description: l.description,
    qty: Number(l.qty),
    unit: l.unit,
    unit_sell: Number(l.unit_sell),
    kind: (l.kind as string | null) ?? null,
  }))

  const paymentData: PaymentData[] = (payments ?? []).map((p) => ({
    id: p.id,
    date: p.date,
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
    source: (p.source as 'ecr' | 'xero') ?? 'ecr',
  }))

  return (
    <InvoiceEditor
      invoice={invoiceData}
      lines={lineData}
      payments={paymentData}
      isAdmin={profile.role === 'admin'}
      xeroConnected={xero.connected}
    />
  )
}
