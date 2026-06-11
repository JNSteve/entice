'use client'

import React, { useState, useTransition } from 'react'
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
import { MoneyInput } from '@/components/MoneyInput'
import { PlusIcon } from 'lucide-react'
import { addJobCost } from '../actions'
import { aud, fmtDate } from '@/lib/format'

const NONE = 'none'

interface CostEntry {
  id: string
  date: string
  description: string
  amount: number
  cost_code_label: string | null
}

interface CostCode {
  id: string
  code: string
  name: string
}

interface CostsSectionProps {
  jobId: string
  costs: CostEntry[]
  costCodes: CostCode[]
}

export function CostsSection({ jobId, costs, costCodes }: CostsSectionProps) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [costCodeId, setCostCodeId] = useState(NONE)

  function reset() {
    setDate(new Date().toISOString().slice(0, 10))
    setDescription('')
    setAmount(null)
    setCostCodeId(NONE)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || amount <= 0) {
      toast.error('Amount must be positive')
      return
    }
    startTransition(async () => {
      const result = await addJobCost({
        job_id: jobId,
        date,
        description,
        amount,
        cost_code_id: costCodeId === NONE ? null : costCodeId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Cost added')
      setOpen(false)
      reset()
    })
  }

  const total = costs.reduce((sum, c) => sum + c.amount, 0)
  const sorted = [...costs].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Costs</h2>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <PlusIcon className="size-4" />
          Add cost
        </Button>
      </div>

      {sorted.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="tabular-nums">{fmtDate(c.date)}</TableCell>
                  <TableCell>{c.description}</TableCell>
                  <TableCell className="text-muted-foreground">{c.cost_code_label ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{aud(c.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium bg-muted/50">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right tabular-nums">{aud(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No costs recorded yet.</p>
      )}

      {/* Add cost dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add cost</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ac-date">Date</Label>
              <Input
                id="ac-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-40"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ac-desc">Description</Label>
              <Input
                id="ac-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Labour — concreting"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ac-code">Cost code (optional)</Label>
              <Select value={costCodeId} onValueChange={(v) => setCostCodeId(v ?? NONE)}>
                <SelectTrigger id="ac-code" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No cost code</SelectItem>
                  {costCodes.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} – {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ac-amount">Amount</Label>
              <MoneyInput
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !amount}>
                {pending ? 'Adding…' : 'Add cost'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
