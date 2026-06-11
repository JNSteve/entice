'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
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
import { createInvoiceFromJob } from '../../invoices/actions'
import { PlusIcon } from 'lucide-react'
import type { InvoiceBasis } from '@/lib/zod'

export interface JobInvoiceRow {
  id: string
  number: string
  status: string
  total: number
  issue_date: string
  paid_at: string | null
}

/** Job statuses from which invoicing is allowed (progress billing onwards). */
const INVOICEABLE_JOB_STATUSES = ['in_progress', 'completed', 'invoiced', 'paid']

const BASIS_OPTIONS: {
  value: InvoiceBasis
  label: string
  description: string
}[] = [
  {
    value: 'quote',
    label: 'From quote',
    description: 'Copy the accepted quote’s lines onto the invoice.',
  },
  {
    value: 'costs',
    label: 'From recorded costs',
    description: 'One line per job cost at cost amount (0 markup) — edit sell prices after.',
  },
  {
    value: 'blank',
    label: 'Blank',
    description: 'Start with no lines and build the invoice manually.',
  },
]

export function InvoiceSection({
  jobId,
  jobStatus,
  hasQuoteBasis,
  invoices,
}: {
  jobId: string
  jobStatus: string
  hasQuoteBasis: boolean
  invoices: JobInvoiceRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [basis, setBasis] = useState<InvoiceBasis>(hasQuoteBasis ? 'quote' : 'costs')

  const canCreate = INVOICEABLE_JOB_STATUSES.includes(jobStatus)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createInvoiceFromJob(jobId, basis)
      // On success the action redirects to /invoices/[id]; only errors return.
      if (result?.error) {
        toast.error(result.error)
      }
    })
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Invoices</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Available once the job is in progress'}
        >
          <PlusIcon className="size-4" />
          Create invoice
        </Button>
      </div>

      {invoices.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total (inc GST)</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-mono text-xs font-medium underline underline-offset-2 hover:text-muted-foreground"
                    >
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{aud(inv.total)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {fmtDate(inv.issue_date)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {inv.paid_at ? fmtDate(inv.paid_at) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canCreate
            ? 'No invoices yet.'
            : 'No invoices yet. Invoicing opens once the job is in progress.'}
        </p>
      )}

      {/* Create invoice dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create invoice</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <Label>Basis</Label>
              {BASIS_OPTIONS.map((opt) => {
                const disabled = opt.value === 'quote' && !hasQuoteBasis
                return (
                  <label
                    key={opt.value}
                    className={
                      disabled
                        ? 'flex cursor-not-allowed items-start gap-3 rounded-lg border p-3 opacity-50'
                        : 'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-muted/50'
                    }
                  >
                    <input
                      type="radio"
                      name="invoice-basis"
                      value={opt.value}
                      checked={basis === opt.value}
                      onChange={() => setBasis(opt.value)}
                      disabled={disabled}
                      className="mt-1 accent-primary"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {disabled
                          ? 'Requires a linked accepted quote with lines.'
                          : opt.description}
                      </span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create invoice'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
