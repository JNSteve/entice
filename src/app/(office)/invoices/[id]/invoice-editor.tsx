'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { MoneyInput } from '@/components/MoneyInput'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, fmtDate, pct } from '@/lib/format'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import { PAYMENT_METHODS, RATE_KINDS, type PaymentMethod, type RateKind } from '@/lib/zod'
import { cn } from '@/lib/utils'
import {
  addInvoiceLine,
  deleteInvoiceLine,
  deletePayment,
  markInvoiceSent,
  moveInvoiceLine,
  recordPayment,
  updateInvoiceHeader,
  updateInvoiceLine,
  voidInvoice,
} from '../actions'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  BanknoteIcon,
  ExternalLinkIcon,
  FileDownIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react'

export interface InvoiceData {
  id: string
  number: string
  status: 'draft' | 'sent' | 'paid' | 'void'
  issue_date: string
  due_date: string | null
  gst_rate: number
  sent_at: string | null
  paid_at: string | null
  client_id: string | null
  client_name: string
  job_id: string | null
  job_number: string | null
  job_title: string | null
  origin: 'ecr' | 'xero'
  needs_review: boolean
  xero: {
    invoice_id: string
    number: string | null
    status: string | null
    total: number | null
    amount_paid: number | null
    amount_credited: number | null
    amount_due: number | null
    online_url: string | null
    pushed_at: string | null
    emailed_at: string | null
    synced_at: string | null
  } | null
}

export interface InvoiceLineData {
  id: string
  position: number
  description: string
  qty: number
  unit: string
  unit_sell: number
  kind: string | null
}

export interface PaymentData {
  id: string
  date: string
  amount: number
  method: string | null
  reference: string | null
  source: 'ecr' | 'xero'
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  eft: 'EFT',
  card: 'Card',
  cheque: 'Cheque',
  other: 'Other',
}

const GRID_EDITABLE =
  'grid-cols-[minmax(10rem,1fr)_4.5rem_4rem_7.5rem_7rem_5.5rem]'
const GRID_READONLY = 'grid-cols-[minmax(10rem,1fr)_4.5rem_4rem_7.5rem_7rem]'

export function InvoiceEditor({
  invoice,
  lines,
  payments,
  isAdmin,
  xeroConnected,
}: {
  invoice: InvoiceData
  lines: InvoiceLineData[]
  payments: PaymentData[]
  isAdmin: boolean
  xeroConnected: boolean
}) {
  const managedInXero = invoice.xero !== null
  const editable = invoice.status === 'draft' && invoice.origin === 'ecr'
  const { total } = docTotals(
    lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })),
    invoice.gst_rate
  )
  const paidToDate = round2(payments.reduce((s, p) => s + p.amount, 0))

  return (
    <div className="flex flex-col gap-6">
      <HeaderCard
        invoice={invoice}
        editable={editable}
        total={total}
        managedInXero={managedInXero}
        xeroConnected={xeroConnected}
      />
      {(invoice.xero || invoice.origin === 'xero') && <XeroPanel invoice={invoice} />}
      <LinesCard invoiceId={invoice.id} lines={lines} editable={editable} />
      {(payments.length > 0 || invoice.status === 'sent' || invoice.status === 'paid') && (
        <PaymentsCard
          invoice={invoice}
          payments={payments}
          total={total}
          isAdmin={isAdmin}
          managedInXero={managedInXero}
        />
      )}
      <TotalsCard lines={lines} gstRate={invoice.gst_rate} paidToDate={paidToDate} />
    </div>
  )
}

// ─── Xero panel ──────────────────────────────────────────────────────────────

function XeroPanel({ invoice }: { invoice: InvoiceData }) {
  const x = invoice.xero
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Xero</h3>
          <span className="text-xs text-muted-foreground">
            {invoice.origin === 'xero' ? 'Raised in Xero — read-only mirror' : 'Managed in Xero since sending'}
          </span>
        </div>
        {invoice.needs_review && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
            Needs matching — this invoice arrived from Xero without a job. Link it from the Money page.
          </p>
        )}
        {x ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><dt className="text-muted-foreground">Xero number</dt><dd className="font-mono text-xs">{x.number ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Xero status</dt><dd className="font-medium">{x.status ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{x.amount_paid != null ? aud(x.amount_paid) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Credited</dt><dd className="tabular-nums">{x.amount_credited != null ? aud(x.amount_credited) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Due</dt><dd className="font-medium tabular-nums">{x.amount_due != null ? aud(x.amount_due) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Last synced</dt><dd>{x.synced_at ? fmtDate(x.synced_at) : '—'}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Not linked to a Xero invoice.</p>
        )}
        {x && (
          <p className="text-xs text-muted-foreground">
            {x.emailed_at ? `Emailed by Xero ${fmtDate(x.emailed_at)}. ` : ''}
            Payments, credits and voids are recorded in Xero and picked up on the next sync.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

function HeaderCard({
  invoice,
  editable,
  total,
  managedInXero,
  xeroConnected,
}: {
  invoice: InvoiceData
  editable: boolean
  total: number
  managedInXero: boolean
  xeroConnected: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [issueDate, setIssueDate] = useState(invoice.issue_date)
  const [dueDate, setDueDate] = useState(invoice.due_date ?? '')
  const [payOpen, setPayOpen] = useState(false)

  function saveHeader(data: { issue_date?: string; due_date?: string | null }) {
    startTransition(async () => {
      const result = await updateInvoiceHeader(invoice.id, data)
      if (result.error) {
        toast.error(result.error)
        setIssueDate(invoice.issue_date)
        setDueDate(invoice.due_date ?? '')
        return
      }
      router.refresh()
    })
  }

  function handleMarkSent() {
    const ok = confirm(
      xeroConnected
        ? `Send ${invoice.number} via Xero?\n\nXero will record the invoice and email it to the client. Lines lock once sent.`
        : `Mark ${invoice.number} as sent?\n\nLines will be locked once the invoice is sent.`
    )
    if (!ok) return
    startTransition(async () => {
      const result = await markInvoiceSent(invoice.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      for (const w of result.warnings ?? []) toast.warning(w)
      toast.success(result.viaXero ? 'Sent via Xero' : 'Invoice marked as sent')
      router.refresh()
    })
  }

  function handleVoid() {
    const ok = confirm(
      `Void ${invoice.number}?\n\nVoided invoices are read-only and excluded from money totals. This cannot be undone.`
    )
    if (!ok) return
    startTransition(async () => {
      const result = await voidInvoice(invoice.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Invoice voided')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-lg font-semibold">{invoice.number}</span>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              Invoice for{' '}
              <span className="font-medium text-foreground">{invoice.client_name}</span>
              {invoice.job_id && invoice.job_number && (
                <>
                  {' '}— job{' '}
                  <Link
                    href={`/jobs/${invoice.job_id}`}
                    className="font-mono text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
                  >
                    {invoice.job_number}
                  </Link>
                  {invoice.job_title ? ` (${invoice.job_title})` : null}
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {invoice.status === 'draft' && invoice.origin === 'ecr' && (
              <Button onClick={handleMarkSent} disabled={pending}>
                <SendIcon />
                {xeroConnected ? 'Send via Xero' : 'Mark sent'}
              </Button>
            )}
            {invoice.status === 'sent' && !managedInXero && (
              <Button onClick={() => setPayOpen(true)} disabled={pending}>
                <BanknoteIcon />
                Record payment
              </Button>
            )}
            {(invoice.status === 'draft' || invoice.status === 'sent') && !managedInXero && (
              <Button
                variant="outline"
                className="text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={handleVoid}
                disabled={pending}
              >
                <BanIcon />
                Void
              </Button>
            )}
            {invoice.xero?.online_url && invoice.status === 'sent' && (
              <a
                href={invoice.xero.online_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                <ExternalLinkIcon />
                Pay-now link
              </a>
            )}
            <a
              href={`/api/pdf/invoice/${invoice.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              <FileDownIcon />
              PDF
            </a>
          </div>
        </div>

        <Separator />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-muted-foreground">Client</dt>
            <dd className="font-medium">
              {invoice.client_id ? (
                <Link
                  href={`/clients/${invoice.client_id}`}
                  className="underline underline-offset-2 hover:text-muted-foreground"
                >
                  {invoice.client_name}
                </Link>
              ) : (
                invoice.client_name
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Label htmlFor="inv-issue-date" className="font-normal text-muted-foreground">
                Issue date
              </Label>
            </dt>
            <dd>
              {editable ? (
                <Input
                  id="inv-issue-date"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  onBlur={() => {
                    if (issueDate && issueDate !== invoice.issue_date) {
                      saveHeader({ issue_date: issueDate })
                    } else if (!issueDate) {
                      setIssueDate(invoice.issue_date)
                    }
                  }}
                  className="mt-0.5 h-7 w-36 tabular-nums"
                />
              ) : (
                <span className="font-medium tabular-nums">{fmtDate(invoice.issue_date)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Label htmlFor="inv-due-date" className="font-normal text-muted-foreground">
                Due date
              </Label>
            </dt>
            <dd>
              {editable ? (
                <Input
                  id="inv-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={() => {
                    if (dueDate !== (invoice.due_date ?? '')) {
                      saveHeader({ due_date: dueDate || null })
                    }
                  }}
                  className="mt-0.5 h-7 w-36 tabular-nums"
                />
              ) : (
                <span className="font-medium tabular-nums">
                  {invoice.due_date ? fmtDate(invoice.due_date) : '—'}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">GST rate</dt>
            <dd className="font-medium tabular-nums">{pct(invoice.gst_rate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sent</dt>
            <dd className="font-medium">{invoice.sent_at ? fmtDate(invoice.sent_at) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="font-medium">{invoice.paid_at ? fmtDate(invoice.paid_at) : '—'}</dd>
          </div>
        </dl>
      </CardContent>

      <RecordPaymentDialog
        invoiceId={invoice.id}
        total={total}
        open={payOpen}
        onOpenChange={setPayOpen}
      />
    </Card>
  )
}

// ─── Lines ───────────────────────────────────────────────────────────────────

function LinesCard({
  invoiceId,
  lines,
  editable,
}: {
  invoiceId: string
  lines: InvoiceLineData[]
  editable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleAddLine() {
    startTransition(async () => {
      const result = await addInvoiceLine(invoiceId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Lines</h3>

        {lines.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No lines yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div
              className={cn(
                'hidden gap-2 px-1 text-xs font-medium text-muted-foreground md:grid',
                editable ? GRID_EDITABLE : GRID_READONLY
              )}
            >
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span>Unit</span>
              <span className="text-right">Unit sell</span>
              <span className="text-right">Total</span>
              {editable && <span className="sr-only">Actions</span>}
            </div>
            {lines.map((line, i) => (
              <InvoiceLineRow
                key={line.id}
                line={line}
                editable={editable}
                isFirst={i === 0}
                isLast={i === lines.length - 1}
              />
            ))}
          </div>
        )}

        {editable && (
          <div>
            <Button variant="outline" size="sm" onClick={handleAddLine} disabled={pending}>
              <PlusIcon />
              Add line
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface LinePayload {
  description: string
  qty: number
  unit: string
  unit_sell: number
  kind: RateKind | null
}

function InvoiceLineRow({
  line,
  editable,
  isFirst,
  isLast,
}: {
  line: InvoiceLineData
  editable: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [description, setDescription] = useState(line.description)
  const [qty, setQty] = useState(String(line.qty))
  const [unit, setUnit] = useState(line.unit)
  const [sell, setSell] = useState<number>(line.unit_sell)
  const [kind, setKind] = useState<string>(line.kind ?? '')

  function revert() {
    setDescription(line.description)
    setQty(String(line.qty))
    setUnit(line.unit)
    setSell(line.unit_sell)
    setKind(line.kind ?? '')
  }

  function save(overrides: Partial<LinePayload> = {}) {
    const payload: LinePayload = {
      description,
      qty: parseFloat(qty) || 0,
      unit: unit.trim() || 'ea',
      unit_sell: sell,
      kind: (kind || null) as RateKind | null,
      ...overrides,
    }
    startTransition(async () => {
      const result = await updateInvoiceLine(line.id, payload)
      if (result.error) {
        toast.error(result.error)
        revert()
        return
      }
      router.refresh()
    })
  }

  function handleSellChange(v: number | null) {
    const newSell = v ?? 0
    if (newSell === sell) return
    setSell(newSell)
    save({ unit_sell: newSell })
  }

  function handleMove(dir: 'up' | 'down') {
    startTransition(async () => {
      const result = await moveInvoiceLine(line.id, dir)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleDelete() {
    if (!confirm('Delete this line?')) return
    startTransition(async () => {
      const result = await deleteInvoiceLine(line.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  const total = lineTotal(parseFloat(qty) || 0, sell)

  if (!editable) {
    return (
      <div
        className={cn(
          'grid items-center gap-2 rounded-md px-1 py-1 text-sm',
          GRID_READONLY
        )}
      >
        <span className="truncate">{line.description || '—'}</span>
        <span className="text-right tabular-nums">{line.qty}</span>
        <span className="text-muted-foreground">{line.unit}</span>
        <span className="text-right tabular-nums">{aud(line.unit_sell)}</span>
        <span className="text-right font-medium tabular-nums">
          {aud(lineTotal(line.qty, line.unit_sell))}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('grid items-center gap-2', GRID_EDITABLE)}>
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== line.description) save({ description })
          }}
          placeholder="Line description…"
        />
        <select
          aria-label="Line kind (Xero account)"
          className="h-7 w-fit rounded-md border border-input bg-transparent px-1.5 text-base text-muted-foreground md:text-sm"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value)
            save({ kind: (e.target.value || null) as RateKind | null })
          }}
        >
          <option value="">Default account</option>
          {RATE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <Input
        aria-label="Quantity"
        type="number"
        min={0}
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={(e) => {
          const n = parseFloat(e.target.value) || 0
          if (n !== line.qty) save({ qty: n })
        }}
        className="text-right tabular-nums"
      />
      <Input
        aria-label="Unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => {
          if (unit.trim() && unit !== line.unit) save({ unit: unit.trim() })
          else if (!unit.trim()) setUnit(line.unit)
        }}
      />
      <MoneyInput value={sell} onChange={handleSellChange} />
      <span className="px-1 text-right text-sm font-medium tabular-nums">
        {aud(total)}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleMove('up')}
          disabled={pending || isFirst}
        >
          <ArrowUpIcon />
          <span className="sr-only">Move line up</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleMove('down')}
          disabled={pending || isLast}
        >
          <ArrowDownIcon />
          <span className="sr-only">Move line down</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          disabled={pending}
        >
          <Trash2Icon className="text-destructive" />
          <span className="sr-only">Delete line</span>
        </Button>
      </div>
    </div>
  )
}

// ─── Payments ────────────────────────────────────────────────────────────────

function PaymentsCard({
  invoice,
  payments,
  total,
  isAdmin,
  managedInXero,
}: {
  invoice: InvoiceData
  payments: PaymentData[]
  total: number
  isAdmin: boolean
  managedInXero: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const canRemove =
    isAdmin && !managedInXero && invoice.status !== 'paid' && invoice.status !== 'void'

  function handleDelete(paymentId: string) {
    if (!confirm('Remove this payment?')) return
    startTransition(async () => {
      const result = await deletePayment(paymentId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Payment removed')
      router.refresh()
    })
  }

  // Running balance: total inc GST less payments so far, in date order.
  const withBalance = payments.reduce<(PaymentData & { balance: number })[]>(
    (acc, p) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].balance : total
      acc.push({ ...p, balance: round2(prev - p.amount) })
      return acc
    },
    []
  )

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Payments</h3>
        {payments.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  {canRemove && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {withBalance.map((p) => {
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums">{fmtDate(p.date)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.method
                          ? p.method === 'xero'
                            ? 'Xero'
                            : (METHOD_LABELS[p.method as PaymentMethod] ?? p.method)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.reference ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{aud(p.amount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{aud(p.balance)}</TableCell>
                      {canRemove && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDelete(p.id)}
                            disabled={pending}
                          >
                            <Trash2Icon className="text-destructive" />
                            <span className="sr-only">Remove payment</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RecordPaymentDialog({
  invoiceId,
  total,
  open,
  onOpenChange,
}: {
  invoiceId: string
  total: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('eft')
  const [reference, setReference] = useState('')

  function reset() {
    setDate(new Date().toISOString().slice(0, 10))
    setAmount(null)
    setMethod('eft')
    setReference('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || amount <= 0) {
      toast.error('Amount must be positive')
      return
    }
    startTransition(async () => {
      const result = await recordPayment({
        invoice_id: invoiceId,
        date,
        amount,
        method,
        reference,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Payment recorded')
      onOpenChange(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Invoice total {aud(total)} inc GST. The invoice is marked paid
            automatically once payments cover the total.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-date">Date</Label>
            <Input
              id="pay-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-amount">Amount</Label>
            <MoneyInput value={amount} onChange={setAmount} placeholder="0.00" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod((v as PaymentMethod) ?? 'eft')}>
              <SelectTrigger id="pay-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-reference">Reference (optional)</Label>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Remittance / receipt number"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !amount}>
              {pending ? 'Recording…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Totals ──────────────────────────────────────────────────────────────────

function TotalsCard({
  lines,
  gstRate,
  paidToDate,
}: {
  lines: InvoiceLineData[]
  gstRate: number
  paidToDate: number
}) {
  const { subtotal, gst, total } = docTotals(
    lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })),
    gstRate
  )
  const balance = round2(total - paidToDate)

  return (
    <Card>
      <CardContent>
        <dl className="ml-auto flex max-w-sm flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-8">
            <dt className="text-muted-foreground">Subtotal (ex GST)</dt>
            <dd className="tabular-nums">{aud(subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-8">
            <dt className="text-muted-foreground">GST ({pct(gstRate)})</dt>
            <dd className="tabular-nums">{aud(gst)}</dd>
          </div>
          <Separator className="my-1" />
          <div className="flex items-center justify-between gap-8 text-base font-semibold">
            <dt>Total inc GST</dt>
            <dd className="tabular-nums">{aud(total)}</dd>
          </div>
          {paidToDate > 0 && (
            <>
              <div className="flex items-center justify-between gap-8">
                <dt className="text-muted-foreground">Paid to date</dt>
                <dd className="tabular-nums">{aud(paidToDate)}</dd>
              </div>
              <div className="flex items-center justify-between gap-8 font-semibold">
                <dt>Balance due</dt>
                <dd className="tabular-nums">{aud(balance)}</dd>
              </div>
            </>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}
