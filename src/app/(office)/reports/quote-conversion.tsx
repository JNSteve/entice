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
import { aud, pct } from '@/lib/format'
import { round2 } from '@/lib/money'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

import { PERIOD_TABS, type PeriodKey } from './periods'

export type ConversionRow = {
  client: string
  sentCount: number
  sentValue: number
  acceptedCount: number
  acceptedValue: number
  /** acceptedCount / sentCount as a percentage. */
  ratePct: number
}

export function QuoteConversionReport({
  rows,
  period,
}: {
  rows: ConversionRow[]
  period: PeriodKey
}) {
  const totals = {
    sentCount: rows.reduce((s, r) => s + r.sentCount, 0),
    sentValue: round2(rows.reduce((s, r) => s + r.sentValue, 0)),
    acceptedCount: rows.reduce((s, r) => s + r.acceptedCount, 0),
    acceptedValue: round2(rows.reduce((s, r) => s + r.acceptedValue, 0)),
  }
  const totalRate =
    totals.sentCount > 0
      ? round2((totals.acceptedCount / totals.sentCount) * 100)
      : 0

  function handleExport() {
    downloadCsv(
      `quote-conversion-${period}-${format(new Date(), 'yyyyMMdd')}.csv`,
      rows.map((r) => ({
        Client: r.client,
        'Sent count': r.sentCount,
        'Sent value': r.sentValue,
        'Accepted count': r.acceptedCount,
        'Accepted value': r.acceptedValue,
        'Conversion %': r.ratePct,
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Period picker */}
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
          {PERIOD_TABS.map((t) => (
            <Link
              key={t.value}
              href={`/reports?report=quote-conversion&period=${t.value}`}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1 text-sm transition-colors',
                period === t.value
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={rows.length === 0}
        >
          <FileDownIcon className="size-4" />
          Export CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No quotes sent in this period.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Sent value</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead className="text-right">Accepted value</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.client}>
                  <TableCell className="font-medium">{r.client}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.sentCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(r.sentValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.acceptedCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(r.acceptedValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(r.ratePct)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.sentCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {aud(totals.sentValue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.acceptedCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {aud(totals.acceptedValue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(totalRate)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
