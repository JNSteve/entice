'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { FileDownIcon } from 'lucide-react'
import { xeroSalesCsv, type XeroInvoice } from '@/lib/xero'
import { aud, fmtDate } from '@/lib/format'
import { format } from 'date-fns'

export interface InvoiceRow {
  id: string
  number: string
  client_name: string
  job: { id: string; number: string } | null
  status: string
  total: number
  issue_date: string
  due_date: string | null
  paid_at: string | null
  // Xero export fields
  xero: XeroInvoice
}

interface Props {
  rows: InvoiceRow[]
  emptyMessage: string
}

function canExport(status: string) {
  return status !== 'draft' && status !== 'void'
}

export function InvoiceTableWithExport({ rows, emptyMessage }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const exportable = rows.filter((r) => canExport(r.status))
  const allSelected = exportable.length > 0 && exportable.every((r) => selectedIds.has(r.id))
  const someSelected = exportable.some((r) => selectedIds.has(r.id))

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(exportable.map((r) => r.id)))
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport() {
    const toExport = exportable.filter((r) => selectedIds.has(r.id)).map((r) => r.xero)
    if (toExport.length === 0) return
    const csv = xeroSalesCsv(toExport)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xero-invoices-${format(new Date(), 'yyyyMMdd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={!someSelected}
          onClick={handleExport}
          title={someSelected ? 'Export selected to Xero CSV' : 'Select invoices to export'}
        >
          <FileDownIcon />
          Export to Xero CSV
          {someSelected && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({exportable.filter((r) => selectedIds.has(r.id)).length})
            </span>
          )}
        </Button>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all exportable invoices"
                />
              </TableHead>
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
            {rows.map((r) => {
              const exportable_ = canExport(r.status)
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      disabled={!exportable_}
                      aria-label={`Select invoice ${r.number}`}
                    />
                  </TableCell>
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
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
