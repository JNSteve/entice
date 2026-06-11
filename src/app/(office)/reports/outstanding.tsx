'use client'

import Link from 'next/link'
import { FileDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, fmtDate } from '@/lib/format'
import { round2 } from '@/lib/money'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

export const AGING_BUCKETS = ['Current', '1–30', '31–60', '61–90', '90+'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export type AgingInvoiceRow = {
  id: string
  number: string
  client: string
  status: string
  dueDate: string | null
  daysOverdue: number
  bucket: AgingBucket
  total: number
}

export type UncertifiedClaimRow = {
  id: string
  projectId: string
  projectLabel: string
  claimNumber: number
  totalIncGst: number | null
  submittedAt: string | null
  daysWaiting: number
}

export type RetentionProjectRow = {
  projectId: string
  projectLabel: string
  held: number
  pcRelease: number
  pcDate: string | null
  finalRelease: number
  finalDate: string | null
}

export function OutstandingReport({
  invoices,
  claims,
  retention,
}: {
  invoices: AgingInvoiceRow[]
  claims: UncertifiedClaimRow[]
  retention: RetentionProjectRow[]
}) {
  const stamp = format(new Date(), 'yyyyMMdd')

  const bucketTotals = AGING_BUCKETS.map((bucket) => ({
    bucket,
    total: round2(
      invoices.filter((i) => i.bucket === bucket).reduce((s, i) => s + i.total, 0)
    ),
  }))
  const invoiceTotal = round2(invoices.reduce((s, i) => s + i.total, 0))

  function exportInvoices() {
    downloadCsv(
      `outstanding-invoices-${stamp}.csv`,
      invoices.map((r) => ({
        Invoice: r.number,
        Client: r.client,
        Status: r.status,
        'Due date': r.dueDate ? fmtDate(r.dueDate) : '',
        'Days overdue': r.daysOverdue,
        Bucket: r.bucket,
        'Total inc GST': r.total,
      }))
    )
  }

  function exportClaims() {
    downloadCsv(
      `uncertified-claims-${stamp}.csv`,
      claims.map((r) => ({
        Project: r.projectLabel,
        Claim: `PC-${r.claimNumber}`,
        'Total inc GST': r.totalIncGst ?? '',
        Submitted: r.submittedAt ? fmtDate(r.submittedAt) : '',
        'Days waiting': r.daysWaiting,
      }))
    )
  }

  function exportRetention() {
    downloadCsv(
      `retention-held-${stamp}.csv`,
      retention.map((r) => ({
        Project: r.projectLabel,
        Held: r.held,
        'PC release': r.pcRelease,
        'PC release date': r.pcDate ? fmtDate(r.pcDate) : '',
        'Final release': r.finalRelease,
        'Final release date': r.finalDate ? fmtDate(r.finalDate) : '',
      }))
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Unpaid invoices aging */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Unpaid invoices</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={exportInvoices}
            disabled={invoices.length === 0}
          >
            <FileDownIcon className="size-4" />
            Export CSV
          </Button>
        </div>

        {/* Bucket summary */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {bucketTotals.map((b) => (
            <div key={b.bucket} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{b.bucket}</p>
              <p className="text-sm font-semibold tabular-nums">{aud(b.total)}</p>
            </div>
          ))}
          <div className="rounded-lg border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-sm font-semibold tabular-nums">{aud(invoiceTotal)}</p>
          </div>
        </div>

        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No unpaid invoices.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Days overdue</TableHead>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Total inc GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/invoices/${r.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>{r.client}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.dueDate ? fmtDate(r.dueDate) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        r.daysOverdue > 30
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : r.daysOverdue > 0
                            ? 'font-medium text-amber-700 dark:text-amber-400'
                            : 'text-muted-foreground'
                      )}
                    >
                      {r.daysOverdue > 0 ? r.daysOverdue : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.bucket}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Uncertified claims */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Uncertified claims</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={exportClaims}
            disabled={claims.length === 0}
          >
            <FileDownIcon className="size-4" />
            Export CSV
          </Button>
        </div>

        {claims.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No submitted claims awaiting certification.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead className="text-right">Total inc GST</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Days waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${r.projectId}`}
                        className="hover:underline"
                      >
                        {r.projectLabel}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${r.projectId}/claims/${r.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        PC-{r.claimNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.totalIncGst != null ? aud(r.totalIncGst) : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.submittedAt ? fmtDate(r.submittedAt) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        r.daysWaiting > 14
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {r.daysWaiting}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Retention held */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Retention held</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={exportRetention}
            disabled={retention.length === 0}
          >
            <FileDownIcon className="size-4" />
            Export CSV
          </Button>
        </div>

        {retention.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No retention currently held.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead className="text-right">PC release</TableHead>
                  <TableHead>PC release date</TableHead>
                  <TableHead className="text-right">Final release</TableHead>
                  <TableHead>Final release date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retention.map((r) => (
                  <TableRow key={r.projectId}>
                    <TableCell>
                      <Link
                        href={`/projects/${r.projectId}`}
                        className="hover:underline"
                      >
                        {r.projectLabel}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {aud(r.held)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.pcRelease)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.pcDate ? fmtDate(r.pcDate) : 'On PC'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.finalRelease)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.finalDate ? fmtDate(r.finalDate) : 'End of DLP'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
