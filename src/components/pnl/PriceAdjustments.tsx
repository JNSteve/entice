'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { PlusIcon, Trash2Icon } from 'lucide-react'
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
import { MoneyInput } from '@/components/MoneyInput'
import { aud, fmtDate } from '@/lib/format'
import { addPriceAdjustment, deletePriceAdjustment, setJobBasePrice } from '@/lib/pnl-actions'
import type { PnlAdjustment } from '@/lib/pnl-queries'
import { withGst } from '@/lib/pnl'

interface PriceAdjustmentsProps {
  jobId: string
  basePrice: number | null
  hasQuote: boolean
  quoteNumber: string | null
  adjustments: PnlAdjustment[]
  price: number | null
  gstRate: number
}

function signed(n: number): string {
  return `${n > 0 ? '+' : '−'}${aud(Math.abs(n))}`
}

const PRICE_GRID = 'grid grid-cols-[1fr_6.5rem_6.5rem_2rem] items-center gap-2 px-4'

/** Job price: quote (or hand-set) base price + a +/- adjustments log. */
export function PriceAdjustments({
  jobId,
  basePrice,
  hasQuote,
  quoteNumber,
  adjustments,
  price,
  gstRate,
}: PriceAdjustmentsProps) {
  const [pending, startTransition] = useTransition()
  const [addOpen, setAddOpen] = useState(false)
  const [setOpen, setSetOpen] = useState(false)
  const canSetBase = !hasQuote || basePrice == null

  function handleDelete(a: PnlAdjustment) {
    if (!confirm(`Delete adjustment "${a.description}" (${aud(a.amount)})?`)) return
    startTransition(async () => {
      const result = await deletePriceAdjustment(a.id)
      if (result.error) toast.error(result.error)
      else toast.success('Adjustment deleted')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Price</h3>
        <div className="flex gap-2">
          {canSetBase && (
            <Button variant="outline" size="sm" onClick={() => setSetOpen(true)}>
              {basePrice == null ? 'Set price' : 'Edit price'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon className="size-4" />
            Add adjustment
          </Button>
        </div>
      </div>

      <div className="rounded-xl border text-sm">
        <div className={`${PRICE_GRID} py-1.5 text-xs text-muted-foreground`}>
          <span />
          <span className="text-right font-medium text-foreground">Ex GST</span>
          <span className="text-right">Inc GST</span>
          <span />
        </div>
        <div className={`${PRICE_GRID} border-t py-2.5`}>
          <span>{hasQuote ? `Accepted quote${quoteNumber ? ` ${quoteNumber}` : ''}` : 'Base price'}</span>
          <span className="text-right tabular-nums">{basePrice != null ? aud(basePrice) : 'Not set'}</span>
          <span className="text-right tabular-nums text-muted-foreground">
            {basePrice != null ? aud(withGst(basePrice, gstRate)) : ''}
          </span>
          <span />
        </div>
        {adjustments.map((a) => (
          <div key={a.id} className={`${PRICE_GRID} border-t py-2`}>
            <span className="min-w-0">
              <span className="text-muted-foreground tabular-nums">{fmtDate(a.date)}</span>{' '}
              {a.description}
            </span>
            <span className="text-right tabular-nums whitespace-nowrap">{signed(a.amount)}</span>
            <span className="text-right tabular-nums whitespace-nowrap text-muted-foreground">
              {signed(withGst(a.amount, gstRate))}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete adjustment"
              disabled={pending}
              onClick={() => handleDelete(a)}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        ))}
        <div className={`${PRICE_GRID} border-t bg-muted/50 py-2.5 font-medium`}>
          <span>Current price</span>
          <span className="text-right tabular-nums">{price != null ? aud(price) : '—'}</span>
          <span className="text-right tabular-nums text-muted-foreground">
            {price != null ? aud(withGst(price, gstRate)) : ''}
          </span>
          <span />
        </div>
      </div>

      {addOpen && (
        <AdjustmentDialog jobId={jobId} gstRate={gstRate} onClose={() => setAddOpen(false)} />
      )}
      {setOpen && (
        <BasePriceDialog
          jobId={jobId}
          current={basePrice}
          gstRate={gstRate}
          onClose={() => setSetOpen(false)}
        />
      )}
    </div>
  )
}

function AdjustmentDialog({
  jobId,
  gstRate,
  onClose,
}: {
  jobId: string
  gstRate: number
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState<number | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await addPriceAdjustment({ job_id: jobId, date, description, amount })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Adjustment added')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add price adjustment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-date">Date</Label>
            <Input
              id="pa-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-desc">Description</Label>
            <Input
              id="pa-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Extra 20 m² removal"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Amount ex GST (negative to reduce)</Label>
            <MoneyInput value={amount} onChange={setAmount} allowNegative placeholder="0.00" />
            <GstHint exGst={amount} gstRate={gstRate} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !amount || !description.trim()}>
              {pending ? 'Adding…' : 'Add adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BasePriceDialog({
  jobId,
  current,
  gstRate,
  onClose,
}: {
  jobId: string
  current: number | null
  gstRate: number
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [price, setPrice] = useState<number | null>(current)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await setJobBasePrice({ job_id: jobId, price })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Price saved')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Job price</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Price ex GST</Label>
            <MoneyInput value={price} onChange={setPrice} placeholder="0.00" />
            <GstHint exGst={price} gstRate={gstRate} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || price == null}>
              {pending ? 'Saving…' : 'Save price'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Live inc-GST equivalent under an ex-GST input, so nobody enters a GST-inclusive figure by mistake. */
export function GstHint({ exGst, gstRate }: { exGst: number | null; gstRate: number }) {
  const inc = exGst != null ? withGst(exGst, gstRate) : null
  return (
    <p className="text-xs text-muted-foreground">
      {inc != null
        ? `= ${inc < 0 ? '−' : ''}${aud(Math.abs(inc))} inc GST. `
        : 'Enter the amount excluding GST. '}
      Got an inc-GST figure? Divide it by {(1 + gstRate / 100).toFixed(2)}.
    </p>
  )
}
