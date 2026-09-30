'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FileUpIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { GstAmountInput } from '@/components/GstAmountInput'
import { aud, fmtDate } from '@/lib/format'
import { COST_CATEGORIES, labourAmount, type CostCategory } from '@/lib/pnl'
import { round2 } from '@/lib/money'
import { kindsForCategory } from '@/lib/price-list'
import type { PriceItemHit } from '@/lib/price-list-actions'
import { ItemSearch } from '@/components/price-list/ItemSearch'
import { PriceListImport } from '@/components/price-list/PriceListImport'
import { addCostLine, deleteCostLine, updateCostLine } from '@/lib/pnl-actions'
import type { PnlCostCodeOption, PnlCostLine, PnlWorkerOption } from '@/lib/pnl-queries'
import { cn } from '@/lib/utils'

const NONE = 'none'
const TYPED = 'typed'

const SOURCE_LABEL: Record<PnlCostLine['source'], string> = {
  labour: 'Labour',
  manual: 'Manual',
  docket: 'Docket',
}

interface CostLinesTableProps {
  parentType: 'job' | 'project'
  parentId: string
  lines: PnlCostLine[]
  workers: PnlWorkerOption[]
  costCodes: PnlCostCodeOption[]
  gstRate: number
  /** e.g. "RJ26013" — shown when importing a supplier document onto this job. */
  parentLabel?: string
}

export function CostLinesTable({
  parentType,
  parentId,
  lines,
  workers,
  costCodes,
  gstRate,
  parentLabel,
}: CostLinesTableProps) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<PnlCostLine | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const total = lines.reduce((s, l) => s + l.amount, 0)

  function handleDelete(line: PnlCostLine) {
    if (!confirm(`Delete "${line.description}" (${aud(line.amount)})?`)) return
    startTransition(async () => {
      const result = await deleteCostLine(line.id)
      if (result.error) toast.error(result.error)
      else toast.success('Cost deleted')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Cost lines</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <FileUpIcon className="size-4" />
            Import supplier invoice
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <PlusIcon className="size-4" />
            Add cost
          </Button>
        </div>
      </div>
      <PriceListImport
        open={importing}
        onClose={() => setImporting(false)}
        gstRate={gstRate}
        job={{ parent_type: parentType, parent_id: parentId, label: parentLabel ?? `this ${parentType}` }}
      />

      {lines.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount (ex GST)</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums whitespace-nowrap">{fmtDate(l.date)}</TableCell>
                  <TableCell>
                    <div>{l.description}</div>
                    {l.source === 'labour' && l.hours != null && l.rate != null && (
                      <div className="text-xs text-muted-foreground">
                        {l.worker_label ?? '—'} · {l.hours} h × {aud(l.rate)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.cost_code_label ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{SOURCE_LABEL[l.source]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{aud(l.amount)}</TableCell>
                  <TableCell className="text-right">
                    {l.source !== 'docket' && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit cost"
                          onClick={() => setEditing(l)}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete cost"
                          disabled={pending}
                          onClick={() => handleDelete(l)}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium bg-muted/50">
                <TableCell colSpan={4}>Total cost lines</TableCell>
                <TableCell className="text-right tabular-nums">{aud(total)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No cost lines yet.</p>
      )}

      {editing && (
        <CostLineDialog
          key={editing === 'new' ? 'new' : editing.id}
          parentType={parentType}
          parentId={parentId}
          line={editing === 'new' ? null : editing}
          workers={workers}
          costCodes={costCodes}
          gstRate={gstRate}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

interface CostLineDialogProps {
  parentType: 'job' | 'project'
  parentId: string
  line: PnlCostLine | null
  workers: PnlWorkerOption[]
  costCodes: PnlCostCodeOption[]
  gstRate: number
  onClose: () => void
}

function CostLineDialog({
  parentType,
  parentId,
  line,
  workers,
  costCodes,
  gstRate,
  onClose,
}: CostLineDialogProps) {
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState<'labour' | 'other'>(line ? (line.source === 'labour' ? 'labour' : 'other') : 'labour')
  const [date, setDate] = useState(line?.date ?? new Date().toISOString().slice(0, 10))
  // An auto-generated labour description is shown blank so it re-derives from
  // the worker on save instead of going stale.
  const [description, setDescription] = useState(
    line && !(line.source === 'labour' && line.description === `Labour — ${line.worker_label}`)
      ? line.description
      : ''
  )
  const [costCodeId, setCostCodeId] = useState(line?.cost_code_id ?? NONE)
  const [amount, setAmount] = useState<number | null>(line && line.source !== 'labour' ? line.amount : null)
  // "Other cost": category + (optionally) a price-list item priced as qty × unit cost.
  const [category, setCategory] = useState<CostCategory>(
    line ? (line.category ?? 'other') : 'materials'
  )
  const [item, setItem] = useState<Pick<PriceItemHit, 'id' | 'name' | 'unit' | 'supplier'> | null>(
    line?.rate_item_id ? { id: line.rate_item_id, name: line.description, unit: 'ea', supplier: null } : null
  )
  const [custom, setCustom] = useState(Boolean(line && !line.rate_item_id))
  const [qty, setQty] = useState(line?.qty != null ? String(line.qty) : '1')
  const [unitCost, setUnitCost] = useState<number | null>(line?.unit_cost ?? null)
  const qtyNum = Number(qty)
  const itemAmount = item && qtyNum > 0 && unitCost != null ? round2(qtyNum * unitCost) : null
  const [workerId, setWorkerId] = useState(
    line?.worker_id ?? (line?.worker_name ? TYPED : workers[0]?.id ?? TYPED)
  )
  const [workerName, setWorkerName] = useState(line?.worker_name ?? '')
  const [hours, setHours] = useState(line?.hours != null ? String(line.hours) : '')
  const [rate, setRate] = useState<number | null>(
    line?.rate ?? (line?.worker_id || line?.worker_name ? null : workers[0]?.hourly_cost ?? null)
  )

  // Keep a known worker selectable even if they've since been deactivated.
  const workerOptions =
    line?.worker_id && !workers.some((w) => w.id === line.worker_id)
      ? [...workers, { id: line.worker_id, full_name: line.worker_label ?? 'Unknown', hourly_cost: null }]
      : workers

  // Keep an inactive cost code on an existing line selectable (and labelled).
  const codeOptions =
    line?.cost_code_id && !costCodes.some((c) => c.id === line.cost_code_id)
      ? [...costCodes, { id: line.cost_code_id, code: line.cost_code_label ?? 'Inactive code', name: '' }]
      : costCodes

  const hoursNum = Number(hours)
  const labourTotal = hoursNum > 0 && rate != null ? labourAmount(hoursNum, rate) : null

  function pickWorker(id: string) {
    setWorkerId(id)
    const w = workerOptions.find((x) => x.id === id)
    if (w?.hourly_cost != null) setRate(w.hourly_cost)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      kind,
      parent_type: parentType,
      parent_id: parentId,
      date,
      description: description.trim(),
      cost_code_id: costCodeId === NONE ? null : costCodeId,
      ...(kind === 'labour'
        ? {
            hours: hoursNum,
            rate: rate ?? undefined,
            worker_id: workerId === TYPED ? null : workerId,
            worker_name: workerId === TYPED ? workerName.trim() : null,
          }
        : item
          ? {
              amount: itemAmount ?? undefined,
              category,
              rate_item_id: item.id,
              qty: qtyNum,
              unit_cost: unitCost ?? undefined,
            }
          : { amount: amount ?? undefined, category }),
    }
    startTransition(async () => {
      const result = line ? await updateCostLine(line.id, payload) : await addCostLine(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(line ? 'Cost updated' : 'Cost added')
      onClose()
    })
  }

  const canSubmit =
    kind === 'labour'
      ? hoursNum > 0 && rate != null && (workerId !== TYPED || workerName.trim() !== '')
      : item
        ? itemAmount != null && itemAmount > 0 && description.trim() !== ''
        : amount != null && amount > 0 && description.trim() !== ''

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{line ? 'Edit cost' : 'Add cost'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="inline-flex w-fit rounded-lg border p-0.5" role="radiogroup" aria-label="Cost type">
            {(['labour', 'other'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm transition-colors',
                  kind === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {k === 'labour' ? 'Labour' : 'Other cost'}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-date">Date</Label>
            <Input
              id="cl-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              required
            />
          </div>

          {kind === 'labour' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-worker">Worker</Label>
                <Select value={workerId} onValueChange={(v) => pickWorker(v ?? TYPED)}>
                  <SelectTrigger id="cl-worker" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workerOptions.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.full_name}
                      </SelectItem>
                    ))}
                    <SelectItem value={TYPED}>Someone else (type a name)</SelectItem>
                  </SelectContent>
                </Select>
                {workerId === TYPED && (
                  <Input
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    placeholder="e.g. Labour hire — J. Smith"
                    aria-label="Worker name"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cl-hours">Hours</Label>
                  <Input
                    id="cl-hours"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.25"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Rate / hour</Label>
                  <MoneyInput value={rate} onChange={setRate} placeholder="0.00" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Cost: <span className="font-medium text-foreground tabular-nums">{labourTotal != null ? aud(labourTotal) : '—'}</span>
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-desc">Description (optional)</Label>
                <Input
                  id="cl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Labour — worker name"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Category</Label>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cost category">
                  {COST_CATEGORIES.filter((c) => c.key !== 'labour').map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      role="radio"
                      aria-checked={category === c.key}
                      onClick={() => {
                        setCategory(c.key)
                        if (!line) {
                          setItem(null)
                          setCustom(c.key === 'other')
                        }
                      }}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm transition-colors',
                        category === c.key ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {!item && !custom && category !== 'other' ? (
                <ItemSearch
                  kinds={kindsForCategory(category)}
                  onPick={(it) => {
                    setItem(it)
                    setUnitCost(it.cost)
                    setDescription(it.name)
                    setQty('1')
                  }}
                  onCustom={() => setCustom(true)}
                />
              ) : item ? (
                <>
                  <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.supplier ? `${item.supplier} · ` : ''}From the price list
                      </span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setItem(null)
                        setCustom(false)
                      }}
                    >
                      Change
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="cl-qty">Qty{item.unit && item.unit !== 'ea' ? ` (${item.unit})` : ''}</Label>
                      <Input
                        id="cl-qty"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Unit cost (ex GST)</Label>
                      <MoneyInput value={unitCost} onChange={setUnitCost} placeholder="0.00" />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Cost:{' '}
                    <span className="font-medium text-foreground tabular-nums">
                      {itemAmount != null ? aud(itemAmount) : '—'}
                    </span>{' '}
                    ex GST
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cl-desc">Description</Label>
                    <Input id="cl-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                </>
              ) : (
                <>
                  {category !== 'other' && (
                    <button
                      type="button"
                      className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => setCustom(false)}
                    >
                      Pick from the price list instead
                    </button>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cl-desc">Description</Label>
                    <Input
                      id="cl-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Excavator hire — 2 days"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Amount</Label>
                    <GstAmountInput
                      value={amount}
                      onChange={setAmount}
                      gstRate={gstRate}
                      defaultMode={line ? 'ex' : 'inc'}
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cl-code">Cost code (optional)</Label>
            <Select value={costCodeId} onValueChange={(v) => setCostCodeId(v ?? NONE)}>
              <SelectTrigger id="cl-code" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No cost code</SelectItem>
                {codeOptions.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.name ? `${cc.code} – ${cc.name}` : cc.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? 'Saving…' : line ? 'Save' : 'Add cost'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
