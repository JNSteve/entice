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
import { EmptyState } from '@/components/EmptyState'
import { MoneyInput } from '@/components/MoneyInput'
import { aud } from '@/lib/format'
import { round2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import { PlusIcon, Trash2Icon, WalletIcon } from 'lucide-react'
import { addBudgetLine, updateBudgetLine, deleteBudgetLine, addProjectCost } from '../../actions'

const NONE = 'none'
const UNCODED = 'uncoded'

export interface BudgetLineRow {
  id: string
  description: string
  budget_amount: number
  cost_code_id: string
}

export interface CostCodeOption {
  id: string
  code: string
  name: string
  active: boolean
}

interface BudgetTableProps {
  projectId: string
  lines: BudgetLineRow[]
  /** Σ committed (PO lines + commitments) attributed to a specific budget_line_id. */
  committedByLine: Record<string, number>
  /** Σ committed for UNLINKED rows, keyed by cost_code_id (or 'uncoded'). */
  committedByCode: Record<string, number>
  /** Σ actual (costs) attributed to a specific budget_line_id. */
  actualByLine: Record<string, number>
  /** Σ actual for UNLINKED rows, keyed by cost_code_id (or 'uncoded'). */
  actualByCode: Record<string, number>
  costCodes: CostCodeOption[]
}

interface Group {
  key: string
  label: string
  lines: BudgetLineRow[]
  budget: number
  committed: number
  actual: number
  variance: number
}

function Variance({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'block text-right tabular-nums font-medium',
        value < 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-green-700 dark:text-green-400'
      )}
    >
      {aud(value)}
    </span>
  )
}

export function BudgetTable({
  projectId,
  lines,
  committedByLine,
  committedByCode,
  actualByLine,
  actualByCode,
  costCodes,
}: BudgetTableProps) {
  const [pending, startTransition] = useTransition()

  // Add line dialog state
  const [addLineOpen, setAddLineOpen] = useState(false)
  const [lineDescription, setLineDescription] = useState('')
  const [lineCostCodeId, setLineCostCodeId] = useState('')
  const [lineAmount, setLineAmount] = useState<number | null>(null)

  // Add cost dialog state
  const [addCostOpen, setAddCostOpen] = useState(false)
  const [costDate, setCostDate] = useState(new Date().toISOString().slice(0, 10))
  const [costDescription, setCostDescription] = useState('')
  const [costCostCodeId, setCostCostCodeId] = useState(NONE)
  const [costBudgetLineId, setCostBudgetLineId] = useState(NONE)
  const [costAmount, setCostAmount] = useState<number | null>(null)

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<BudgetLineRow | null>(null)

  const activeCodes = costCodes.filter((cc) => cc.active)
  const codeLabel = (id: string) => {
    if (id === UNCODED) return 'Uncoded'
    const cc = costCodes.find((c) => c.id === id)
    return cc ? `${cc.code} – ${cc.name}` : 'Unknown code'
  }

  // ── Grouping by cost code ──────────────────────────────────────────────────
  const groupKeys = new Set<string>([
    ...lines.map((l) => l.cost_code_id),
    ...Object.keys(committedByCode),
    ...Object.keys(actualByCode),
  ])

  const groups: Group[] = [...groupKeys]
    .map((key) => {
      const groupLines = lines.filter((l) => l.cost_code_id === key)
      const budget = round2(groupLines.reduce((s, l) => s + l.budget_amount, 0))
      // Header = spend attributed to this group's individual lines + unlinked
      // spend sitting at this cost code. Each source row is in exactly one bucket.
      const linkedCommitted = groupLines.reduce((s, l) => s + (committedByLine[l.id] ?? 0), 0)
      const linkedActual = groupLines.reduce((s, l) => s + (actualByLine[l.id] ?? 0), 0)
      const committed = round2(linkedCommitted + (committedByCode[key] ?? 0))
      const actual = round2(linkedActual + (actualByCode[key] ?? 0))
      return {
        key,
        label: codeLabel(key),
        lines: groupLines,
        budget,
        committed,
        actual,
        variance: round2(budget - Math.max(committed, actual)),
      }
    })
    .sort((a, b) =>
      a.key === UNCODED ? 1 : b.key === UNCODED ? -1 : a.label.localeCompare(b.label)
    )

  const totalBudget = round2(groups.reduce((s, g) => s + g.budget, 0))
  const totalCommitted = round2(groups.reduce((s, g) => s + g.committed, 0))
  const totalActual = round2(groups.reduce((s, g) => s + g.actual, 0))
  const totalVariance = round2(totalBudget - Math.max(totalCommitted, totalActual))

  // ── Actions ────────────────────────────────────────────────────────────────
  function resetAddLine() {
    setLineDescription('')
    setLineCostCodeId('')
    setLineAmount(null)
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault()
    if (!lineCostCodeId) {
      toast.error('Pick a cost code')
      return
    }
    startTransition(async () => {
      const result = await addBudgetLine({
        project_id: projectId,
        cost_code_id: lineCostCodeId,
        description: lineDescription,
        budget_amount: lineAmount ?? 0,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Budget line added')
      setAddLineOpen(false)
      resetAddLine()
    })
  }

  function handleBudgetChange(line: BudgetLineRow, value: number | null) {
    const next = value ?? 0
    if (next === line.budget_amount) return
    startTransition(async () => {
      const result = await updateBudgetLine(line.id, projectId, {
        budget_amount: next,
      })
      if (result.error) toast.error(result.error)
    })
  }

  function handleRecode(line: BudgetLineRow, costCodeId: string) {
    if (costCodeId === line.cost_code_id) return
    startTransition(async () => {
      const result = await updateBudgetLine(line.id, projectId, {
        cost_code_id: costCodeId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Line re-coded')
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    startTransition(async () => {
      const result = await deleteBudgetLine(target.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Budget line deleted')
      setDeleteTarget(null)
    })
  }

  function resetAddCost() {
    setCostDate(new Date().toISOString().slice(0, 10))
    setCostDescription('')
    setCostCostCodeId(NONE)
    setCostBudgetLineId(NONE)
    setCostAmount(null)
  }

  function handleAddCost(e: React.FormEvent) {
    e.preventDefault()
    if (!costAmount || costAmount <= 0) {
      toast.error('Amount must be positive')
      return
    }
    startTransition(async () => {
      const result = await addProjectCost({
        project_id: projectId,
        date: costDate,
        description: costDescription,
        amount: costAmount,
        cost_code_id: costCostCodeId === NONE ? null : costCostCodeId,
        budget_line_id: costBudgetLineId === NONE ? null : costBudgetLineId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Cost added')
      setAddCostOpen(false)
      resetAddCost()
    })
  }

  const isEmpty = groups.length === 0

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Budget</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddCostOpen(true)}>
            <PlusIcon className="size-4" />
            Add cost
          </Button>
          <Button size="sm" onClick={() => setAddLineOpen(true)}>
            <PlusIcon className="size-4" />
            Add line
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<WalletIcon className="size-8" />}
          title="No budget yet"
          description="Break the contract down into cost-coded budget lines."
          action={
            <Button onClick={() => setAddLineOpen(true)}>
              <PlusIcon className="size-4" />
              Add your first budget line
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <React.Fragment key={g.key}>
                  {/* Group header — committed/actual/variance live at cost-code level */}
                  <TableRow className="bg-muted/50">
                    <TableCell className="font-medium" colSpan={2}>
                      {g.label}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {aud(g.budget)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {aud(g.committed)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {aud(g.actual)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Variance value={g.variance} />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {g.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="pl-6">{line.description}</TableCell>
                      <TableCell>
                        <Select
                          value={line.cost_code_id}
                          onValueChange={(v) => v && handleRecode(line, v)}
                        >
                          <SelectTrigger size="sm" className="w-full max-w-48 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {costCodes
                              .filter((cc) => cc.active || cc.id === line.cost_code_id)
                              .map((cc) => (
                                <SelectItem key={cc.id} value={cc.id}>
                                  {cc.code} – {cc.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyInput
                          value={line.budget_amount}
                          onChange={(v) => handleBudgetChange(line, v)}
                          className="ml-auto h-8 w-32"
                        />
                      </TableCell>
                      {(() => {
                        const committed = committedByLine[line.id] ?? 0
                        const actual = actualByLine[line.id] ?? 0
                        const variance = round2(line.budget_amount - Math.max(committed, actual))
                        return (
                          <>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {committed ? aud(committed) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {actual ? aud(actual) : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              {committed || actual ? <Variance value={variance} /> : null}
                            </TableCell>
                          </>
                        )
                      })()}
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(line)}
                        >
                          <Trash2Icon className="size-4" />
                          <span className="sr-only">Delete line</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
              {/* Grand totals */}
              <TableRow className="bg-muted font-medium">
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {aud(totalBudget)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {aud(totalCommitted)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {aud(totalActual)}
                </TableCell>
                <TableCell className="text-right">
                  <Variance value={totalVariance} />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add line dialog */}
      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add budget line</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddLine} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bl-desc">Description</Label>
              <Input
                id="bl-desc"
                value={lineDescription}
                onChange={(e) => setLineDescription(e.target.value)}
                placeholder="Concrete supply"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bl-code">Cost code</Label>
              <Select
                value={lineCostCodeId || null}
                onValueChange={(v) => v && setLineCostCodeId(v)}
              >
                <SelectTrigger id="bl-code" className="w-full">
                  <SelectValue placeholder="Pick a cost code…" />
                </SelectTrigger>
                <SelectContent>
                  {activeCodes.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} – {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bl-amount">Budget amount</Label>
              <MoneyInput value={lineAmount} onChange={setLineAmount} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !lineCostCodeId}>
                {pending ? 'Adding…' : 'Add line'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add cost dialog */}
      <Dialog open={addCostOpen} onOpenChange={setAddCostOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add cost</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddCost} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pc-date">Date</Label>
              <Input
                id="pc-date"
                type="date"
                value={costDate}
                onChange={(e) => setCostDate(e.target.value)}
                className="w-40"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pc-desc">Description</Label>
              <Input
                id="pc-desc"
                value={costDescription}
                onChange={(e) => setCostDescription(e.target.value)}
                placeholder="Labour — formwork"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pc-code">Cost code (optional)</Label>
              <Select
                value={costCostCodeId}
                onValueChange={(v) => setCostCostCodeId(v ?? NONE)}
              >
                <SelectTrigger id="pc-code" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No cost code</SelectItem>
                  {activeCodes.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} – {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pc-line">Budget line (optional)</Label>
              <Select
                value={costBudgetLineId}
                onValueChange={(v) => {
                  const next = v ?? NONE
                  setCostBudgetLineId(next)
                  // Keep the cost code consistent with the chosen line.
                  if (next !== NONE) {
                    const bl = lines.find((l) => l.id === next)
                    if (bl) setCostCostCodeId(bl.cost_code_id)
                  }
                }}
              >
                <SelectTrigger id="pc-line" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No specific line</SelectItem>
                  {lines.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pc-amount">Amount</Label>
              <MoneyInput value={costAmount} onChange={setCostAmount} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !costAmount}>
                {pending ? 'Adding…' : 'Add cost'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete budget line?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget
              ? `"${deleteTarget.description}" will be removed from the budget. This cannot be undone.`
              : ''}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
