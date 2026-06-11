import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { aud, fmtDate } from '@/lib/format'
import { docTotals } from '@/lib/money'
import { cn } from '@/lib/utils'
import { FileDownIcon } from 'lucide-react'

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
      'id, number, status, gst_rate, issue_date, due_date, paid_at, clients(name), jobs(id, number), invoice_lines(qty, unit_sell)'
    )
    .order('created_at', { ascending: false })
  if (filter === 'unpaid') query = query.in('status', ['draft', 'sent'])
  if (filter === 'paid') query = query.eq('status', 'paid')

  const { data: invoices } = await query

  const rows = (invoices ?? []).map((inv) => {
    const { total } = docTotals(
      ((inv.invoice_lines ?? []) as { qty: number; unit_sell: number }[]).map((l) => ({
        qty: Number(l.qty),
        unitSell: Number(l.unit_sell),
      })),
      Number(inv.gst_rate)
    )
    return {
      id: inv.id,
      number: inv.number,
      client_name: (inv.clients as unknown as { name: string } | null)?.name ?? '—',
      job: inv.jobs as unknown as { id: string; number: string } | null,
      status: inv.status as string,
      total,
      issue_date: inv.issue_date as string,
      due_date: inv.due_date as string | null,
      paid_at: inv.paid_at as string | null,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Money"
        description="Invoices, claims and payments."
        actions={
          // Xero CSV export lands in the next task.
          <Button variant="outline" disabled title="Coming soon">
            <FileDownIcon />
            Export to Xero CSV
          </Button>
        }
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

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filter === 'all'
            ? 'No invoices yet. Create one from a job card.'
            : 'No invoices match this filter.'}
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total (inc GST)</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${r.id}`}
                      className="font-mono text-xs font-medium underline underline-offset-2 hover:text-muted-foreground"
                    >
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell>{r.client_name}</TableCell>
                  <TableCell>
                    {r.job ? (
                      <Link
                        href={`/jobs/${r.job.id}`}
                        className="font-mono text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {r.job.number}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{aud(r.total)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {fmtDate(r.issue_date)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.due_date ? fmtDate(r.due_date) : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.paid_at ? fmtDate(r.paid_at) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
