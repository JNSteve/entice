import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { docTotals } from '@/lib/money'
import { InvoiceTableWithExport, type InvoiceRow } from './xero-export-button'

const FILTER_TABS = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
] as const

type Filter = (typeof FILTER_TABS)[number]['value']

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireRole('admin', 'office')

  const { filter: rawFilter } = await searchParams
  const filter: Filter = FILTER_TABS.some((t) => t.value === rawFilter)
    ? (rawFilter as Filter)
    : 'all'

  const supabase = await createClient()

  let query = supabase
    .from('invoices')
    .select(
      'id, number, status, gst_rate, issue_date, due_date, paid_at, clients(name), jobs(id, number), invoice_lines(description, qty, unit_sell)'
    )
    .order('created_at', { ascending: false })
  if (filter === 'unpaid') query = query.in('status', ['draft', 'sent'])
  if (filter === 'paid') query = query.eq('status', 'paid')

  const { data: invoices } = await query

  const rows: InvoiceRow[] = (invoices ?? []).map((inv) => {
    const lines = ((inv.invoice_lines ?? []) as { description: string; qty: number; unit_sell: number }[]).map(
      (l) => ({
        qty: Number(l.qty),
        unitSell: Number(l.unit_sell),
      })
    )
    const { total } = docTotals(lines, Number(inv.gst_rate))
    const job = inv.jobs as unknown as { id: string; number: string } | null

    return {
      id: inv.id,
      number: inv.number,
      client_name: (inv.clients as unknown as { name: string } | null)?.name ?? '—',
      job,
      status: inv.status as string,
      total,
      issue_date: inv.issue_date as string,
      due_date: inv.due_date as string | null,
      paid_at: inv.paid_at as string | null,
      xero: {
        number: inv.number,
        contactName: (inv.clients as unknown as { name: string } | null)?.name ?? '',
        invoiceDate: inv.issue_date as string,
        dueDate: (inv.due_date ?? inv.issue_date) as string,
        reference: job?.number,
        lines: ((inv.invoice_lines ?? []) as { description: string; qty: number; unit_sell: number }[]).map(
          (l) => ({
            description: l.description ?? '',
            qty: Number(l.qty),
            unitAmount: Number(l.unit_sell),
          })
        ),
      },
    }
  })

  const emptyMessage =
    filter === 'all'
      ? 'No invoices yet. Create one from a job card.'
      : 'No invoices match this filter.'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Money"
        description="Invoices, claims and payments."
      />

      <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        {FILTER_TABS.map((t) => (
          <Link
            key={t.value}
            href={t.value === 'all' ? '/money' : `/money?filter=${t.value}`}
            className={cn(
              'rounded-md px-3 py-1 text-sm transition-colors',
              filter === t.value
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <InvoiceTableWithExport rows={rows} emptyMessage={emptyMessage} />
    </div>
  )
}
