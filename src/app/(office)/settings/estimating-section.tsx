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
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { CalculatorIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import {
  createTakeoffAssembly,
  updateTakeoffAssembly,
  setTakeoffAssemblyActive,
  addAssemblyComponent,
  updateAssemblyComponent,
  deleteAssemblyComponent,
} from './actions'

const NO_RATE = 'none'

export interface AssemblyComponentRow {
  id: string
  description: string
  unit: string
  factor: number
  fixed_qty: number | null
  rate_item_id: string | null
}

export interface TakeoffAssemblyRow {
  id: string
  name: string
  unit: string
  description: string | null
  active: boolean
  components: AssemblyComponentRow[]
}

export interface RateItemOption {
  id: string
  name: string
  unit: string
  cost: number
}

export function EstimatingSection({
  assemblies,
  rateItems,
}: {
  assemblies: TakeoffAssemblyRow[]
  rateItems: RateItemOption[]
}) {
  const rateNames = new Map(rateItems.map((r) => [r.id, r.name]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Takeoff assembly templates. One unit of an assembly explodes into its
          component quantities when estimating.
        </p>
        <AssemblyDialog />
      </div>

      {assemblies.length === 0 ? (
        <EmptyState
          icon={<CalculatorIcon className="size-8" />}
          title="No assemblies yet"
          description="Create an assembly so a measured quantity can explode into labour, materials and disposal lines."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {assemblies.map((assembly) => (
            <AssemblyCard
              key={assembly.id}
              assembly={assembly}
              rateItems={rateItems}
              rateNames={rateNames}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Assembly card ────────────────────────────────────────────────────────────

function AssemblyCard({
  assembly,
  rateItems,
  rateNames,
}: {
  assembly: TakeoffAssemblyRow
  rateItems: RateItemOption[]
  rateNames: Map<string, string>
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{assembly.name}</span>
            <span className="text-sm text-muted-foreground">
              per {assembly.unit}
            </span>
            <ActiveBadge active={assembly.active} />
          </div>
          {assembly.description && (
            <p className="text-sm text-muted-foreground">
              {assembly.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <AssemblyDialog assembly={assembly} />
          <ToggleActiveButton
            active={assembly.active}
            label={assembly.name}
            onToggle={(active) => setTakeoffAssemblyActive(assembly.id, active)}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Rate item</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assembly.components.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-muted-foreground"
                >
                  No components yet.
                </TableCell>
              </TableRow>
            ) : (
              assembly.components.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.description}</TableCell>
                  <TableCell className="text-muted-foreground">{c.unit}</TableCell>
                  <TableCell className="tabular-nums">
                    {c.fixed_qty != null ? (
                      <span>Flat: {c.fixed_qty}</span>
                    ) : (
                      <span>×{c.factor}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.rate_item_id ? rateNames.get(c.rate_item_id) ?? '—' : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <ComponentDialog
                        assemblyId={assembly.id}
                        component={c}
                        rateItems={rateItems}
                      />
                      <DeleteComponentButton id={c.id} label={c.description} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Factor multiplies the assembly quantity; a flat qty ignores it (per-job
          items).
        </p>
        <ComponentDialog assemblyId={assembly.id} rateItems={rateItems} />
      </div>
    </div>
  )
}

// ─── Delete component ─────────────────────────────────────────────────────────

function DeleteComponentButton({ id, label }: { id: string; label: string }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await deleteAssemblyComponent(id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${label} removed`)
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleClick}
      disabled={pending}
      className="text-destructive hover:text-destructive"
    >
      <Trash2Icon />
      <span className="sr-only">Remove component</span>
    </Button>
  )
}

// ─── Assembly dialog (create / edit) ──────────────────────────────────────────

function AssemblyDialog({ assembly }: { assembly?: TakeoffAssemblyRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(assembly?.name ?? '')
  const [unit, setUnit] = useState(assembly?.unit ?? 'm2')
  const [description, setDescription] = useState(assembly?.description ?? '')

  function resetForm() {
    if (!assembly) {
      setName('')
      setUnit('m2')
      setDescription('')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = { name, unit, description }
      const result = assembly
        ? await updateTakeoffAssembly(assembly.id, payload)
        : await createTakeoffAssembly(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(assembly ? 'Assembly updated' : 'Assembly created')
      setOpen(false)
      resetForm()
    })
  }

  return (
    <>
      {assembly ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit assembly</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New assembly
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{assembly ? 'Edit assembly' : 'New assembly'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ta-name">Name</Label>
              <Input
                id="ta-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Class A friable removal — ceiling/wall"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ta-unit">Unit</Label>
              <Input
                id="ta-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="m2"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ta-desc">Description</Label>
              <Textarea
                id="ta-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What one unit of this assembly explodes into"
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : assembly
                    ? 'Save changes'
                    : 'Create assembly'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Component dialog (add / edit) ────────────────────────────────────────────

function ComponentDialog({
  assemblyId,
  component,
  rateItems,
}: {
  assemblyId: string
  component?: AssemblyComponentRow
  rateItems: RateItemOption[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [description, setDescription] = useState(component?.description ?? '')
  const [unit, setUnit] = useState(component?.unit ?? 'ea')
  const [factor, setFactor] = useState(
    component ? String(component.factor) : '1'
  )
  const [fixedQty, setFixedQty] = useState(
    component?.fixed_qty != null ? String(component.fixed_qty) : ''
  )
  const [rateItemId, setRateItemId] = useState<string>(
    component?.rate_item_id ?? NO_RATE
  )

  function resetForm() {
    if (!component) {
      setDescription('')
      setUnit('ea')
      setFactor('1')
      setFixedQty('')
      setRateItemId(NO_RATE)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        assembly_id: assemblyId,
        description,
        unit,
        factor: factor === '' ? 1 : Number(factor),
        fixed_qty: fixedQty === '' ? null : Number(fixedQty),
        rate_item_id: rateItemId === NO_RATE ? null : rateItemId,
      }
      const result = component
        ? await updateAssemblyComponent(component.id, payload)
        : await addAssemblyComponent(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(component ? 'Component updated' : 'Component added')
      setOpen(false)
      resetForm()
    })
  }

  return (
    <>
      {component ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit component</span>
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <PlusIcon />
          Add component
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {component ? 'Edit component' : 'Add component'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tc-desc">Description</Label>
              <Input
                id="tc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Removal labour"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tc-unit">Unit</Label>
                <Input
                  id="tc-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="hr"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tc-factor">Per-unit factor</Label>
                <Input
                  id="tc-factor"
                  type="number"
                  step="any"
                  min="0"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  placeholder="0.5"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tc-fixed">Flat qty (optional)</Label>
                <Input
                  id="tc-fixed"
                  type="number"
                  step="any"
                  min="0"
                  value={fixedQty}
                  onChange={(e) => setFixedQty(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tc-rate">Rate item</Label>
              <Select
                value={rateItemId}
                onValueChange={(v) => setRateItemId(v ?? NO_RATE)}
              >
                <SelectTrigger id="tc-rate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RATE}>No rate</SelectItem>
                  {rateItems.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Factor multiplies the assembly quantity; a flat qty ignores it
              (per-job items).
            </p>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : component
                    ? 'Save changes'
                    : 'Add component'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
