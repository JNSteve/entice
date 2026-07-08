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
import { Textarea } from '@/components/ui/textarea'
import { BudgetAttributionFields, type BudgetLineOption } from '@/components/BudgetAttributionFields'
import { StatusBadge } from '@/components/StatusBadge'
import { MoneyInput } from '@/components/MoneyInput'
import { aud, fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import { lineTotal, round2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import { PlusIcon, Trash2Icon, FileTextIcon, CheckCircleIcon, XCircleIcon, LockIcon } from 'lucide-react'
import {
  updatePoHeader,
  addPoLine,
  updatePoLine,
  deletePoLine,
  setPoStatus,
} from '../actions'

export interface PoLine {
  id: string
  position: number
  description: string
  cost_code_id: string | null
  budget_line_id: string | null
  qty: number
  unit: string
  unit_cost: number
}

export interface CostCodeOption {
  id: string
  code: string
  name: string
  active: boolean
}

export interface VendorOption {
  id: string
  name: string
}

export type { BudgetLineOption }

export interface PoEditorProps {
  projectId: string
  po: {
    id: string
    number: string
    vendor_id: string
    vendor_name: string
    status: string
    issue_date: string | null
    notes: string | null
  }
  lines: PoLine[]
  costCodes: CostCodeOption[]
  vendors: VendorOption[]
  budgetLines: BudgetLineOption[]
  gstRate: number
}

const NONE = 'none'

export function PoEditor({ projectId, po: initialPo, lines: initialLines, costCodes, budgetLines, gstRate }: PoEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [po, setPo] = useState(initialPo)
  const [lines, setLines] = useState<PoLine[]>(initialLines)

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(po.notes ?? '')

  // Add line dialog
  const [addOpen, setAddOpen] = useState(false)
  const [lineDesc, setLineDesc] = useState('')
  const [lineCostCode, setLineCostCode] = useState<string | null>(null)
  const [lineQty, setLineQty] = useState<number | null>(1)
  const [lineUnit, setLineUnit] = useState('ea')
  const [lineUnitCost, setLineUnitCost] = useState<number | null>(null)
  const [lineBudgetLine, setLineBudgetLine] = useState<string | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<PoLine | null>(null)

  // Status action confirms
  const [issueConfirmOpen, setIssueConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)

  const isDraft = po.status === 'draft'
  const isIssued = po.status === 'issued'

  const activeCodes = costCodes.filter((cc) => cc.active)
  const codeLabel = (id: string | null) => {
    if (!id) return '—'
    const cc = costCodes.find((c) => c.id === id)
    return cc ? `${cc.code} – ${cc.name}` : '—'
  }

  const hasBudgetLines = budgetLines.length > 0
  const budgetLineLabel = (id: string | null) =>
    id ? budgetLines.find((b) => b.id === id)?.description ?? '—' : '—'

  // Totals
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_cost), 0))
  const gst = round2(subtotal * gstRate / 100)
  const total = round2(subtotal + gst)

  // ── Notes ────────────────────────────────────────────────────────────────────

  function handleSaveNotes() {
    startTransition(async () => {
      const result = await updatePoHeader(po.id, projectId, { notes: notesValue || undefined })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setPo((prev) => ({ ...prev, notes: notesValue || null }))
      setEditingNotes(false)
      toast.success('Notes saved')
    })
  }

  // ── Add line ─────────────────────────────────────────────────────────────────

  function resetAddLine() {
    setLineDesc('')
    setLineCostCode(null)
    setLineQty(1)
    setLineUnit('ea')
    setLineUnitCost(null)
    setLineBudgetLine(null)
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault()
    if (!lineDesc) { toast.error('Description is required'); return }
    if (!lineQty || lineQty <= 0) { toast.error('Qty must be positive'); return }
    if (!lineUnit) { toast.error('Unit is required'); return }
    startTransition(async () => {
      const result = await addPoLine({
        po_id: po.id,
        description: lineDesc,
        cost_code_id: lineCostCode,
        budget_line_id: lineBudgetLine,
        qty: lineQty ?? 1,
        unit: lineUnit,
        unit_cost: lineUnitCost ?? 0,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Line added')
      setAddOpen(false)
      resetAddLine()
      router.refresh()
    })
  }

  // ── Inline line edits ────────────────────────────────────────────────────────

  function handleLineUnitCostChange(line: PoLine, value: number | null) {
    const next = value ?? 0
    if (next === line.unit_cost) return
    setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, unit_cost: next } : l))
    startTransition(async () => {
      const result = await updatePoLine(line.id, po.id, projectId, { unit_cost: next })
      if (result.error) toast.error(result.error)
    })
  }

  function handleLineQtyChange(line: PoLine, value: number | null) {
    const next = value ?? 1
    if (next === line.qty) return
    setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, qty: next } : l))
    startTransition(async () => {
      const result = await updatePoLine(line.id, po.id, projectId, { qty: next })
      if (result.error) toast.error(result.error)
    })
  }

  function handleLineCostCode(line: PoLine, codeId: string) {
    const next = codeId === NONE ? null : codeId
    if (next === line.cost_code_id) return
    // Re-coding a linked line unlinks it — the budget rollup attributes by
    // budget_line_id first, so a kept link would silently override this code.
    setLines((prev) => prev.map((l) => l.id === line.id ? { ...l, cost_code_id: next, budget_line_id: null } : l))
    startTransition(async () => {
      const result = await updatePoLine(line.id, po.id, projectId, { cost_code_id: next, budget_line_id: null })
      if (result.error) toast.error(result.error)
    })
  }

  function handleLineBudgetLine(line: PoLine, v: string) {
    const next = v === NONE ? null : v
    if (next === line.budget_line_id) return
    const bl = next ? budgetLines.find((b) => b.id === next) ?? null : null
    setLines((prev) => prev.map((l) =>
      l.id === line.id
        ? { ...l, budget_line_id: next, cost_code_id: bl ? bl.cost_code_id : l.cost_code_id }
        : l
    ))
    startTransition(async () => {
      // The server derives cost_code_id from the linked line.
      const result = await updatePoLine(line.id, po.id, projectId, { budget_line_id: next })
      if (result.error) toast.error(result.error)
    })
  }

  function handleDeleteLine() {
    if (!deleteTarget) return
    const target = deleteTarget
    startTransition(async () => {
      const result = await deletePoLine(target.id, po.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setLines((prev) => prev.filter((l) => l.id !== target.id))
      setDeleteTarget(null)
      toast.success('Line deleted')
    })
  }

  // ── Status transitions ────────────────────────────────────────────────────────

  function handleIssue() {
    startTransition(async () => {
      const result = await setPoStatus(po.id, projectId, { status: 'issued' })
      if (result.error) {
        toast.error(result.error)
        return
      }
      // Optimistic issue_date in the AU calendar day, matching the server's todayAU.
      setPo((prev) => ({ ...prev, status: 'issued', issue_date: todayAUClient() }))
      setIssueConfirmOpen(false)
      toast.success('PO issued — lines are now locked')
    })
  }

  function handleClose() {
    startTransition(async () => {
      const result = await setPoStatus(po.id, projectId, { status: 'closed' })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setPo((prev) => ({ ...prev, status: 'closed' }))
      toast.success('PO closed')
    })
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await setPoStatus(po.id, projectId, { status: 'cancelled' })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setPo((prev) => ({ ...prev, status: 'cancelled' }))
      setCancelConfirmOpen(false)
      toast.success('PO cancelled')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight font-mono">{po.number}</h1>
              <StatusBadge status={po.status} />
              {!isDraft && <LockIcon className="size-4 text-muted-foreground" />}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Supplier: <span className="font-medium text-foreground">{po.vendor_name}</span></span>
              {po.issue_date && (
                <span>Issued: <span className="font-medium text-foreground tabular-nums">{fmtDate(po.issue_date)}</span></span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/api/pdf/po/${po.id}`, '_blank')}
            >
              <FileTextIcon className="size-4" />
              PDF
            </Button>
            {isDraft && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={pending}
                >
                  <XCircleIcon className="size-4" />
                  Cancel PO
                </Button>
                <Button
                  size="sm"
                  onClick={() => setIssueConfirmOpen(true)}
                  disabled={pending || lines.length === 0}
                >
                  <CheckCircleIcon className="size-4" />
                  Issue PO
                </Button>
              </>
            )}
            {isIssued && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => setCancelConfirmOpen(true)}
                  disabled={pending}
                >
                  <XCircleIcon className="size-4" />
                  Cancel PO
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClose}
                  disabled={pending}
                >
                  Close PO
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          {isDraft && editingNotes ? (
            <div className="flex flex-col gap-1.5">
              <Textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="Notes…"
                rows={3}
                className="text-sm"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSaveNotes} disabled={pending}>
                  {pending ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditingNotes(false); setNotesValue(po.notes ?? '') }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'text-sm text-muted-foreground',
                isDraft && 'cursor-pointer hover:text-foreground'
              )}
              onClick={() => isDraft && setEditingNotes(true)}
              title={isDraft ? 'Click to edit notes' : undefined}
            >
              {po.notes || (isDraft ? <span className="italic">Add notes…</span> : null)}
            </div>
          )}
        </div>
      </div>

      {/* Lines table */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Lines</h2>
          {isDraft && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <PlusIcon className="size-4" />
              Add line
            </Button>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No lines yet.{isDraft ? ' Add a line to get started.' : ''}
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Cost code</TableHead>
                  {hasBudgetLines && <TableHead>Budget line</TableHead>}
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {isDraft && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell>
                      {isDraft ? (
                        <Select
                          value={line.cost_code_id ?? NONE}
                          onValueChange={(v) => v && handleLineCostCode(line, v)}
                        >
                          <SelectTrigger size="sm" className="w-full max-w-48 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No code</SelectItem>
                            {costCodes
                              .filter((cc) => cc.active || cc.id === line.cost_code_id)
                              .map((cc) => (
                                <SelectItem key={cc.id} value={cc.id}>
                                  {cc.code} – {cc.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm text-muted-foreground">{codeLabel(line.cost_code_id)}</span>
                      )}
                    </TableCell>
                    {hasBudgetLines && (
                      <TableCell>
                        {isDraft ? (
                          <Select
                            value={line.budget_line_id ?? NONE}
                            onValueChange={(v) => v && handleLineBudgetLine(line, v)}
                          >
                            <SelectTrigger size="sm" className="w-full max-w-48 text-xs">
                              <SelectValue />
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
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {budgetLineLabel(line.budget_line_id)}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {isDraft ? (
                        <MoneyInput
                          value={line.qty}
                          onChange={(v) => handleLineQtyChange(line, v)}
                          className="ml-auto h-8 w-24"
                          allowNegative={false}
                        />
                      ) : (
                        <span className="tabular-nums">{line.qty}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{line.unit}</TableCell>
                    <TableCell className="text-right">
                      {isDraft ? (
                        <MoneyInput
                          value={line.unit_cost}
                          onChange={(v) => handleLineUnitCostChange(line, v)}
                          className="ml-auto h-8 w-32"
                        />
                      ) : (
                        <span className="tabular-nums">{aud(line.unit_cost)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {aud(lineTotal(line.qty, line.unit_cost))}
                    </TableCell>
                    {isDraft && (
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
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Totals */}
        {lines.length > 0 && (
          <div className="ml-auto w-60 rounded-lg border p-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal (ex GST)</span>
              <span className="tabular-nums font-medium">{aud(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">GST ({gstRate}%)</span>
              <span className="tabular-nums">{aud(gst)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Total inc GST</span>
              <span className="tabular-nums">{aud(total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Add line dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add line</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddLine} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-desc">Description</Label>
              <Input
                id="pl-desc"
                value={lineDesc}
                onChange={(e) => setLineDesc(e.target.value)}
                placeholder="Concrete supply — grade 32 MPa"
                required
              />
            </div>
            <BudgetAttributionFields
              idPrefix="pl"
              costCodes={activeCodes}
              budgetLines={budgetLines}
              costCodeId={lineCostCode}
              budgetLineId={lineBudgetLine}
              onChange={(next) => {
                setLineCostCode(next.costCodeId)
                setLineBudgetLine(next.budgetLineId)
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-qty">Qty</Label>
                <MoneyInput value={lineQty} onChange={setLineQty} allowNegative={false} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-unit">Unit</Label>
                <Input
                  id="pl-unit"
                  value={lineUnit}
                  onChange={(e) => setLineUnit(e.target.value)}
                  placeholder="ea, m³, t…"
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-cost">Unit cost</Label>
              <MoneyInput value={lineUnitCost} onChange={setLineUnitCost} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Adding…' : 'Add line'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete line confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete line?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget ? `"${deleteTarget.description}" will be removed.` : ''}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLine} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue confirm */}
      <Dialog open={issueConfirmOpen} onOpenChange={setIssueConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Issue purchase order?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Issuing <span className="font-mono font-medium">{po.number}</span> will lock all lines and record this as a committed cost against the budget. The order cannot be edited after issuing.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleIssue} disabled={pending}>
              {pending ? 'Issuing…' : 'Issue PO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel purchase order?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cancelling <span className="font-mono font-medium">{po.number}</span> will remove it from committed costs. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={pending}>
              {pending ? 'Cancelling…' : 'Cancel PO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
