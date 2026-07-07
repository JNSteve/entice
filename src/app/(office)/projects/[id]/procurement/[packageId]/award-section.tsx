'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MoneyInput } from '@/components/MoneyInput'
import { aud, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AwardIcon, StarIcon, Undo2Icon } from 'lucide-react'
import { awardPackage, unawardPackage } from './actions'
import type { CostCodeOption } from '../packages-table'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AwardQuoteOption {
  id: string
  vendor_id: string
  vendor_name: string
  amount: number
  recommended: boolean
}

export interface AwardedCommitment {
  id: string
  vendor_name: string
  amount: number
  date: string
  description: string
}

export interface BudgetLineOption {
  id: string
  description: string
  cost_code_id: string
}

interface AwardSectionProps {
  projectId: string
  packageId: string
  packageName: string
  budgetAmount: number
  packageCostCodeId: string | null
  quotes: AwardQuoteOption[]
  costCodes: CostCodeOption[]
  budgetLines: BudgetLineOption[]
  awardedCommitment: AwardedCommitment | null
  isAdmin: boolean
}

const NONE = '__none__'

function deltaText(amount: number, budget: number): string {
  const delta = amount - budget
  if (delta === 0) return 'on budget'
  return delta < 0 ? `${aud(-delta)} under budget` : `${aud(delta)} over budget`
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AwardSection({
  projectId,
  packageId,
  packageName,
  budgetAmount,
  packageCostCodeId,
  quotes,
  costCodes,
  budgetLines,
  awardedCommitment,
  isAdmin,
}: AwardSectionProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [unawardPending, startUnawardTransition] = useTransition()

  const recommended = quotes.find((q) => q.recommended) ?? null

  // Award dialog state
  const [awardOpen, setAwardOpen] = useState(false)
  const [vendorId, setVendorId] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [costCodeId, setCostCodeId] = useState<string>(NONE)
  const [budgetLineId, setBudgetLineId] = useState<string>(NONE)
  const [description, setDescription] = useState('')

  // Un-award confirm
  const [unawardOpen, setUnawardOpen] = useState(false)

  function openAwardDialog() {
    const initial = recommended ?? quotes[0] ?? null
    setVendorId(initial?.vendor_id ?? '')
    setAmount(initial?.amount ?? null)
    setCostCodeId(packageCostCodeId ?? NONE)
    setBudgetLineId(NONE)
    setDescription(initial ? `${packageName} — ${initial.vendor_name}` : packageName)
    setAwardOpen(true)
  }

  function handleVendorChange(v: string | null) {
    if (!v) return
    setVendorId(v)
    const quote = quotes.find((q) => q.vendor_id === v)
    if (quote) {
      setAmount(quote.amount)
      setDescription(`${packageName} — ${quote.vendor_name}`)
    }
  }

  function handleAward(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId) {
      toast.error('Pick a supplier')
      return
    }
    if (amount == null || amount <= 0) {
      toast.error('Enter the award amount')
      return
    }
    startTransition(async () => {
      const result = await awardPackage(packageId, projectId, {
        vendor_id: vendorId,
        amount,
        cost_code_id: costCodeId === NONE ? null : costCodeId,
        budget_line_id: budgetLineId === NONE ? null : budgetLineId,
        description: description.trim(),
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Package awarded')
      setAwardOpen(false)
      router.refresh()
    })
  }

  function handleUnaward() {
    startUnawardTransition(async () => {
      const result = await unawardPackage(packageId, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Award reversed')
      setUnawardOpen(false)
      router.refresh()
    })
  }

  // ── Awarded state card ───────────────────────────────────────────────────────
  if (awardedCommitment) {
    const delta = awardedCommitment.amount - budgetAmount
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Award</h2>
        <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 font-medium">
                <AwardIcon className="size-4 text-green-600 dark:text-green-400" />
                Awarded to {awardedCommitment.vendor_name}
              </p>
              <p className="text-sm text-muted-foreground">
                {aud(awardedCommitment.amount)} ·{' '}
                <span
                  className={cn(
                    delta > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  )}
                >
                  {deltaText(awardedCommitment.amount, budgetAmount)}
                </span>{' '}
                · awarded {fmtDate(awardedCommitment.date)}
              </p>
              <p className="text-sm text-muted-foreground">
                This commitment now appears in{' '}
                <Link
                  href={`/projects/${projectId}/budget`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  committed costs on the budget tab
                </Link>
                .
              </p>
            </div>
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setUnawardOpen(true)}
              >
                <Undo2Icon className="size-4" />
                Un-award
              </Button>
            )}
          </div>
        </div>

        {/* Un-award confirm */}
        <Dialog open={unawardOpen} onOpenChange={setUnawardOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Un-award package?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This deletes the {aud(awardedCommitment.amount)} commitment to{' '}
              {awardedCommitment.vendor_name} and returns the package to Quotes
              In. Committed costs on the budget tab will reduce accordingly.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnawardOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={unawardPending}
                onClick={handleUnaward}
              >
                {unawardPending ? 'Reversing…' : 'Un-award'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    )
  }

  // ── Pre-award state ──────────────────────────────────────────────────────────
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Award</h2>
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {recommended ? (
            <p className="flex items-center gap-2 text-sm">
              <StarIcon className="size-4 fill-amber-400 text-amber-400" />
              <span>
                Recommended:{' '}
                <span className="font-medium">{recommended.vendor_name}</span> at{' '}
                <span className="font-medium tabular-nums">
                  {aud(recommended.amount)}
                </span>{' '}
                —{' '}
                <span
                  className={cn(
                    recommended.amount > budgetAmount
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  )}
                >
                  {deltaText(recommended.amount, budgetAmount)}
                </span>
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recommendation yet — star a quote in the comparison above, or
              award directly.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            disabled={quotes.length === 0}
            onClick={openAwardDialog}
          >
            <AwardIcon className="size-4" />
            Award package
          </Button>
        </div>
      </div>

      {/* Award confirm dialog */}
      <Dialog open={awardOpen} onOpenChange={setAwardOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Award package</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAward} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="award-vendor">Supplier</Label>
              <Select value={vendorId || null} onValueChange={handleVendorChange}>
                <SelectTrigger id="award-vendor" className="w-full">
                  <SelectValue placeholder="Pick a supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {quotes.map((q) => (
                    <SelectItem key={q.vendor_id} value={q.vendor_id}>
                      {q.vendor_name} — {aud(q.amount)}
                      {q.recommended ? ' ★' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Amount</Label>
              <MoneyInput value={amount} onChange={setAmount} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="award-costcode">Cost code</Label>
              <Select
                value={costCodeId}
                onValueChange={(v) => setCostCodeId(v ?? NONE)}
              >
                <SelectTrigger id="award-costcode" className="w-full">
                  <SelectValue placeholder="Select cost code…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {costCodes.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="award-budgetline">Budget line (optional)</Label>
              <Select
                value={budgetLineId}
                onValueChange={(v) => {
                  const next = v ?? NONE
                  setBudgetLineId(next)
                  // Keep the cost code consistent with the chosen line.
                  if (next !== NONE) {
                    const bl = budgetLines.find((b) => b.id === next)
                    if (bl) setCostCodeId(bl.cost_code_id)
                  }
                }}
              >
                <SelectTrigger id="award-budgetline" className="w-full">
                  <SelectValue placeholder="No specific line" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No specific line</SelectItem>
                  {budgetLines.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="award-description">Description</Label>
              <Input
                id="award-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Awarding creates an active subcontract commitment that counts
              towards committed costs on the budget tab.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAwardOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !vendorId || amount == null || !description.trim()}
              >
                {pending ? 'Awarding…' : 'Award package'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
