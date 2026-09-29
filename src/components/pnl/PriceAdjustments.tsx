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

interface PriceAdjustmentsProps {
  jobId: string
  basePrice: number | null
  hasQuote: boolean
  adjustments: PnlAdjustment[]
  price: number | null
}

/** Job price: quote (or hand-set) base price + a +/- adjustments log. */
export function PriceAdjustments({ jobId, basePrice, hasQuote, adjustments, price }: PriceAdjustmentsProps) {
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
        <h3 className="text-sm font-semibold">Price (ex GST)</h3>
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
        <div className="flex justify-between gap-4 px-4 py-2.5">
          <span>{hasQuote ? 'Accepted quote' : 'Base price'}</span>
          <span className="tabular-nums">{basePrice != null ? aud(basePrice) : 'Not set'}</span>
        </div>
        {adjustments.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-4 border-t px-4 py-2">
            <span className="min-w-0">
              <span className="text-muted-foreground tabular-nums">{fmtDate(a.date)}</span>{' '}
              {a.description}
            </span>
            <span className="flex items-center gap-1">
              <span className="tabular-nums whitespace-nowrap">
                {a.amount > 0 ? '+' : '−'}
                {aud(Math.abs(a.amount))}
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
            </span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t bg-muted/50 px-4 py-2.5 font-medium">
          <span>Current price</span>
          <span className="tabular-nums">{price != null ? aud(price) : '—'}</span>
        </div>
      </div>

      {addOpen && <AdjustmentDialog jobId={jobId} onClose={() => setAddOpen(false)} />}
      {setOpen && (
        <BasePriceDialog jobId={jobId} current={basePrice} onClose={() => setSetOpen(false)} />
      )}
    </div>
  )
}

function AdjustmentDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
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
            <Label>Amount (ex GST, negative to reduce)</Label>
            <MoneyInput value={amount} onChange={setAmount} allowNegative placeholder="0.00" />
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
  onClose,
}: {
  jobId: string
  current: number | null
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
            <Label>Price (ex GST)</Label>
            <MoneyInput value={price} onChange={setPrice} placeholder="0.00" />
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
