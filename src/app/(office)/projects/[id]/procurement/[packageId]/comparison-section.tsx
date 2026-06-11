'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/MoneyInput'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PencilIcon, PlusIcon, StarIcon } from 'lucide-react'
import { setRecommended, upsertQuote } from './actions'
import type { RfqRow } from './rfq-section'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuoteRow {
  id: string
  vendor_id: string
  amount: number
  inclusions: string | null
  exclusions: string | null
  notes: string | null
  recommended: boolean
  received_at: string
}

interface ComparisonSectionProps {
  projectId: string
  packageId: string
  budgetAmount: number
  rfqs: RfqRow[]
  quotes: QuoteRow[]
  awarded: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ComparisonSection({
  projectId,
  packageId,
  budgetAmount,
  rfqs,
  quotes,
  awarded,
}: ComparisonSectionProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [recommendPending, startRecommendTransition] = useTransition()

  // Quote dialog state
  const [dialogVendor, setDialogVendor] = useState<RfqRow | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [inclusions, setInclusions] = useState('')
  const [exclusions, setExclusions] = useState('')
  const [notes, setNotes] = useState('')
  const [receivedAt, setReceivedAt] = useState('')

  const quoteByVendor = new Map(quotes.map((q) => [q.vendor_id, q]))

  const cheapestAmount =
    quotes.length > 0 ? Math.min(...quotes.map((q) => q.amount)) : null

  function openQuoteDialog(rfq: RfqRow) {
    const existing = quoteByVendor.get(rfq.vendor_id)
    setAmount(existing?.amount ?? null)
    setInclusions(existing?.inclusions ?? '')
    setExclusions(existing?.exclusions ?? '')
    setNotes(existing?.notes ?? '')
    setReceivedAt(existing?.received_at ?? new Date().toISOString().slice(0, 10))
    setDialogVendor(rfq)
  }

  function handleSubmitQuote(e: React.FormEvent) {
    e.preventDefault()
    if (!dialogVendor) return
    if (amount == null) {
      toast.error('Enter the quoted amount')
      return
    }
    startTransition(async () => {
      const result = await upsertQuote(packageId, projectId, {
        vendor_id: dialogVendor.vendor_id,
        amount,
        inclusions: inclusions || null,
        exclusions: exclusions || null,
        notes: notes || null,
        received_at: receivedAt,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Quote saved')
      setDialogVendor(null)
      router.refresh()
    })
  }

  function handleRecommend(quote: QuoteRow) {
    startRecommendTransition(async () => {
      const result = await setRecommended(packageId, projectId, quote.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Quote recommended')
      router.refresh()
    })
  }

  const editable = !awarded

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Quote comparison</h2>

      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32 min-w-32">
                {/* row labels */}
              </th>
              {rfqs.map((rfq) => {
                const quote = quoteByVendor.get(rfq.vendor_id)
                const cheapest =
                  quote != null && quote.amount === cheapestAmount
                return (
                  <th
                    key={rfq.id}
                    className={cn(
                      'px-4 py-3 text-left font-medium min-w-52 align-top',
                      cheapest && 'bg-green-50/60 dark:bg-green-950/30'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate">{rfq.vendor_name}</span>
                      {quote?.recommended && (
                        <StarIcon className="size-4 shrink-0 fill-amber-400 text-amber-400" />
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-normal">
                      <StatusBadge status={rfq.status} />
                      {editable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openQuoteDialog(rfq)}
                        >
                          {quote ? (
                            <>
                              <PencilIcon className="size-3" />
                              Edit
                            </>
                          ) : (
                            <>
                              <PlusIcon className="size-3" />
                              Add quote
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {/* Amount row */}
            <ComparisonRow label="Amount" rfqs={rfqs} cheapestAmount={cheapestAmount} quoteByVendor={quoteByVendor}>
              {(quote) => {
                const delta = quote.amount - budgetAmount
                return (
                  <div className="flex flex-col gap-1">
                    <span className="font-medium tabular-nums">
                      {aud(quote.amount)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex w-fit rounded-md border px-1.5 py-0.5 text-xs tabular-nums',
                        delta > 0
                          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
                          : 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300'
                      )}
                    >
                      {delta > 0 ? '+' : ''}
                      {aud(delta)} vs budget
                    </span>
                  </div>
                )
              }}
            </ComparisonRow>

            {/* Inclusions */}
            <ComparisonRow label="Inclusions" rfqs={rfqs} cheapestAmount={cheapestAmount} quoteByVendor={quoteByVendor}>
              {(quote) => <TextCell value={quote.inclusions} />}
            </ComparisonRow>

            {/* Exclusions */}
            <ComparisonRow label="Exclusions" rfqs={rfqs} cheapestAmount={cheapestAmount} quoteByVendor={quoteByVendor}>
              {(quote) => <TextCell value={quote.exclusions} />}
            </ComparisonRow>

            {/* Notes */}
            <ComparisonRow label="Notes" rfqs={rfqs} cheapestAmount={cheapestAmount} quoteByVendor={quoteByVendor}>
              {(quote) => <TextCell value={quote.notes} />}
            </ComparisonRow>

            {/* Received */}
            <ComparisonRow label="Received" rfqs={rfqs} cheapestAmount={cheapestAmount} quoteByVendor={quoteByVendor}>
              {(quote) => (
                <span className="tabular-nums">{fmtDate(quote.received_at)}</span>
              )}
            </ComparisonRow>

            {/* Recommend */}
            {editable && quotes.length > 0 && (
              <tr>
                <td className="px-4 py-3 text-muted-foreground align-top">
                  Recommend
                </td>
                {rfqs.map((rfq) => {
                  const quote = quoteByVendor.get(rfq.vendor_id)
                  const cheapest =
                    quote != null && quote.amount === cheapestAmount
                  return (
                    <td
                      key={rfq.id}
                      className={cn(
                        'px-4 py-3 align-top',
                        cheapest && 'bg-green-50/60 dark:bg-green-950/30'
                      )}
                    >
                      {quote ? (
                        quote.recommended ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                            <StarIcon className="size-4 fill-amber-400 text-amber-400" />
                            Recommended
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={recommendPending}
                            onClick={() => handleRecommend(quote)}
                          >
                            <StarIcon className="size-4" />
                            Recommend
                          </Button>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Quote dialog */}
      <Dialog
        open={!!dialogVendor}
        onOpenChange={(v) => {
          if (!v) setDialogVendor(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogVendor && quoteByVendor.has(dialogVendor.vendor_id)
                ? `Edit quote — ${dialogVendor?.vendor_name}`
                : `Add quote — ${dialogVendor?.vendor_name}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitQuote} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>
                Amount <span className="text-destructive">*</span>
              </Label>
              <MoneyInput value={amount} onChange={setAmount} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-inclusions">Inclusions</Label>
              <Textarea
                id="quote-inclusions"
                value={inclusions}
                onChange={(e) => setInclusions(e.target.value)}
                rows={2}
                placeholder="What the price includes…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-exclusions">Exclusions</Label>
              <Textarea
                id="quote-exclusions"
                value={exclusions}
                onChange={(e) => setExclusions(e.target.value)}
                rows={2}
                placeholder="What is excluded…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-notes">Notes</Label>
              <Textarea
                id="quote-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-received">Received date</Label>
              <Input
                id="quote-received"
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogVendor(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || amount == null}>
                {pending ? 'Saving…' : 'Save quote'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TextCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return <span className="whitespace-pre-wrap text-sm">{value}</span>
}

function ComparisonRow({
  label,
  rfqs,
  quoteByVendor,
  cheapestAmount,
  children,
}: {
  label: string
  rfqs: RfqRow[]
  quoteByVendor: Map<string, QuoteRow>
  cheapestAmount: number | null
  children: (quote: QuoteRow) => React.ReactNode
}) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3 text-muted-foreground align-top">{label}</td>
      {rfqs.map((rfq) => {
        const quote = quoteByVendor.get(rfq.vendor_id)
        const cheapest = quote != null && quote.amount === cheapestAmount
        return (
          <td
            key={rfq.id}
            className={cn(
              'px-4 py-3 align-top',
              cheapest && 'bg-green-50/60 dark:bg-green-950/30'
            )}
          >
            {quote ? (
              children(quote)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
        )
      })}
    </tr>
  )
}
