import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  InvoiceEditor,
  type InvoiceData,
  type InvoiceLineData,
  type PaymentData,
} from './invoice-editor'

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
        .select('id, position, description, qty, unit, unit_sell')
        .eq('invoice_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('payments')
        .select('id, date, amount, method, reference')
        .eq('invoice_id', id)
        .order('date')
        .order('id'),
    ])

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
  }

  const lineData: InvoiceLineData[] = (lines ?? []).map((l) => ({
    id: l.id,
    position: l.position,
    description: l.description,
    qty: Number(l.qty),
    unit: l.unit,
    unit_sell: Number(l.unit_sell),
  }))

  const paymentData: PaymentData[] = (payments ?? []).map((p) => ({
    id: p.id,
    date: p.date,
    amount: Number(p.amount),
    method: p.method,
    reference: p.reference,
  }))

  return (
    <InvoiceEditor
      invoice={invoiceData}
      lines={lineData}
      payments={paymentData}
      isAdmin={profile.role === 'admin'}
    />
  )
}
