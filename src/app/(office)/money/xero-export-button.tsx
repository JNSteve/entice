'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { FileDownIcon, Link2Icon, RefreshCwIcon } from 'lucide-react'
import { xeroSalesCsv, type XeroInvoice } from '@/lib/xero-csv'
import { aud, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { syncXeroNow } from '../settings/xero-actions'
import { MatchJobDialog } from './match-job-dialog'

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
  origin: 'ecr' | 'xero'
  needs_review: boolean
  client_id: string
  xero_status: string | null
  xero_amount_due: number | null
  xero_online_url: string | null
  // Xero export fields
  xero: XeroInvoice
}

interface Props {
  rows: InvoiceRow[]
  emptyMessage: string
  xeroConnected: boolean
}

function canExport(status: string) {
  return status !== 'draft' && status !== 'void'
}

export function InvoiceTableWithExport({ rows, emptyMessage, xeroConnected }: Props) {
  const router = useRouter()
  const [syncing, startSync] = useTransition()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [matching, setMatching] = useState<InvoiceRow | null>(null)

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
      <div className="flex flex-wrap items-center justify-end gap-2">
        {xeroConnected ? (
          <Button variant="outline" disabled={syncing} onClick={() => startSync(async () => {
            const r = await syncXeroNow()
            if (r.error) toast.error(r.error)
            else toast.success(r.summary ?? 'Sync complete')
            router.refresh()
          })}>
            <RefreshCwIcon className={cn(syncing && 'animate-spin')} />
            Sync with Xero
          </Button>
        ) : (
          <Button variant="outline" disabled={!someSelected} onClick={handleExport} title={someSelected ? 'Export selected to Xero CSV' : 'Select invoices to export'}>
            <FileDownIcon />
            Export to Xero CSV
            {someSelected && <span className="ml-1 text-xs text-muted-foreground">{`(${exportable.filter((r) => selectedIds.has(r.id)).length})`}</span>}
          </Button>
        )}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {!xeroConnected && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all exportable invoices"
                  />
                </TableHead>
              )}
              <TableHead>Number</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Xero</TableHead>
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
                  {!xeroConnected && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggle(r.id)}
                        disabled={!exportable_}
                        aria-label={`Select invoice ${r.number}`}
                      />
                    </TableCell>
                  )}
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
                  <TableCell>
                    {r.xero_status ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{r.xero_status}</span>
                        {r.xero_amount_due != null && r.status === 'sent' && <span className="tabular-nums">{`${aud(r.xero_amount_due)} due`}</span>}
                        {r.xero_online_url && r.status === 'sent' && <a href={r.xero_online_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Pay link</a>}
                        {r.origin === 'xero' && <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">from Xero</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.needs_review && (
                      <button type="button" className="mt-1 flex items-center gap-1 text-xs text-amber-700 underline underline-offset-2" onClick={() => setMatching(r)}>
                        <Link2Icon className="size-3" />Match to a job
                      </button>
                    )}
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
      <MatchJobDialog invoice={matching} onClose={() => setMatching(null)} />
    </div>
  )
}
