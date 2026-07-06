'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FactoryIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { expiryColour } from '@/lib/compliance'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import { type PermitUsage } from '@/lib/env'
import {
  WASTE_CLASSIFICATIONS,
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNITS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import {
  createEnvFacility,
  updateEnvFacility,
  deleteEnvFacility,
  createEnvPermit,
  updateEnvPermit,
  deleteEnvPermit,
} from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FacilityRow {
  id: string
  name: string
  licence_no: string | null
  licence_expiry: string | null
  waste_types: string | null
  active: boolean
}

export interface PermitRow {
  id: string
  project_id: string
  project_label: string
  reference: string
  description: string | null
  classification: WasteClassification
  allowance_qty: number
  allowance_unit: WasteUnitKey
  expiry: string | null
  usage: PermitUsage
}

export interface ProjectOption {
  id: string
  label: string
}

// ─── Permit usage bar (shared with the project Environment tab) ───────────────

export function PermitUsageBar({ usage }: { usage: PermitUsage }) {
  const pct = usage.pctUsed
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const barColour =
    usage.level === 'over'
      ? 'bg-red-500'
      : usage.level === 'warn'
        ? 'bg-amber-400'
        : 'bg-green-500'
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', barColour)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span
        className={cn(
          'shrink-0 text-xs font-medium tabular-nums',
          usage.level === 'over'
            ? 'text-red-600 dark:text-red-400'
            : usage.level === 'warn'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground'
        )}
      >
        {pct}%
      </span>
      {usage.level !== 'ok' && (
        <span
          className={cn(
            'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            usage.level === 'over'
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300'
              : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
          )}
        >
          {usage.level === 'over' ? 'Over' : '≥80%'}
        </span>
      )}
    </div>
  )
}

// ─── Facility dialog ──────────────────────────────────────────────────────────

function FacilityDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing?: FacilityRow
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState(() => ({
    name: existing?.name ?? '',
    licence_no: existing?.licence_no ?? '',
    licence_expiry: existing?.licence_expiry ?? '',
    waste_types: existing?.waste_types ?? '',
    active: existing?.active ?? true,
  }))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      name: form.name,
      licence_no: form.licence_no || null,
      licence_expiry: form.licence_expiry || null,
      waste_types: form.waste_types || null,
      active: form.active,
    }
    startTransition(async () => {
      const result = existing
        ? await updateEnvFacility(existing.id, payload)
        : await createEnvFacility(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(existing ? 'Facility updated' : 'Facility added')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit facility' : 'Add facility'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Facility name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Licence number</Label>
              <Input
                value={form.licence_no}
                onChange={(e) =>
                  setForm((f) => ({ ...f, licence_no: e.target.value }))
                }
                placeholder="EA / EPA licence no."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Licence expiry</Label>
              <Input
                type="date"
                value={form.licence_expiry}
                onChange={(e) =>
                  setForm((f) => ({ ...f, licence_expiry: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Waste types accepted</Label>
            <Textarea
              value={form.waste_types}
              onChange={(e) =>
                setForm((f) => ({ ...f, waste_types: e.target.value }))
              }
              placeholder="e.g. Asbestos waste; contaminated soil; regulated waste"
              rows={2}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) =>
                setForm((f) => ({ ...f, active: e.target.checked }))
              }
              className="size-4"
            />
            Active — available for new loads
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : existing ? 'Save' : 'Add facility'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Permit dialog ────────────────────────────────────────────────────────────

export function PermitDialog({
  open,
  onOpenChange,
  projects,
  lockedProjectId,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectOption[]
  lockedProjectId?: string
  existing?: PermitRow
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState(() => ({
    project_id: existing?.project_id ?? lockedProjectId ?? '',
    reference: existing?.reference ?? '',
    description: existing?.description ?? '',
    classification: existing?.classification ?? ('general' as WasteClassification),
    allowance_qty: existing ? String(existing.allowance_qty) : '',
    allowance_unit: existing?.allowance_unit ?? ('t' as WasteUnitKey),
    expiry: existing?.expiry ?? '',
  }))

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.project_id) {
      toast.error('Pick the project this permit belongs to')
      return
    }
    const payload = {
      project_id: form.project_id,
      reference: form.reference,
      description: form.description || null,
      classification: form.classification,
      allowance_qty: form.allowance_qty,
      allowance_unit: form.allowance_unit,
      expiry: form.expiry || null,
    }
    startTransition(async () => {
      const result = existing
        ? await updateEnvPermit(existing.id, payload)
        : await createEnvPermit(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(existing ? 'Permit updated' : 'Permit added')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit permit' : 'Add permit'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!lockedProjectId && (
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select
                value={form.project_id || '__none'}
                onValueChange={(v) =>
                  field('project_id', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Permit / approval reference</Label>
            <Input
              value={form.reference}
              onChange={(e) => field('reference', e.target.value)}
              placeholder="e.g. RAP disposal allowance, EA condition ref"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Classification</Label>
              <Select
                value={form.classification}
                onValueChange={(v) => v && field('classification', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WASTE_CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {WASTE_CLASSIFICATION_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Allowance</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={form.allowance_qty}
                onChange={(e) => field('allowance_qty', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <Select
                value={form.allowance_unit}
                onValueChange={(v) => v && field('allowance_unit', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WASTE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {WASTE_UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Expiry</Label>
            <Input
              type="date"
              value={form.expiry}
              onChange={(e) => field('expiry', e.target.value)}
              className="w-44"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : existing ? 'Save' : 'Add permit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function FacilitiesSection({
  facilities,
  permits,
  projects,
  canManage,
  isAdmin,
}: {
  facilities: FacilityRow[]
  permits: PermitRow[]
  projects: ProjectOption[]
  canManage: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [facilityDialog, setFacilityDialog] = useState(false)
  const [editingFacility, setEditingFacility] = useState<FacilityRow | null>(null)
  const [permitDialog, setPermitDialog] = useState(false)
  const [editingPermit, setEditingPermit] = useState<PermitRow | null>(null)

  function handleDeleteFacility(f: FacilityRow) {
    if (!confirm(`Delete facility "${f.name}"?`)) return
    startTransition(async () => {
      const result = await deleteEnvFacility(f.id)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Facility deleted')
        router.refresh()
      }
    })
  }

  function handleDeletePermit(p: PermitRow) {
    if (!confirm(`Delete permit "${p.reference}"?`)) return
    startTransition(async () => {
      const result = await deleteEnvPermit(p.id)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Permit deleted')
        router.refresh()
      }
    })
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Facilities */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Licensed facilities</h2>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditingFacility(null)
                setFacilityDialog(true)
              }}
            >
              <PlusIcon className="size-4" />
              Add facility
            </Button>
          )}
        </div>
        {facilities.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            <FactoryIcon className="size-5 shrink-0" />
            No facilities on the register yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead>Licence expiry</TableHead>
                  <TableHead>Waste types accepted</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {facilities.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-[260px] text-sm font-medium">
                      {f.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.licence_no ?? '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-sm tabular-nums',
                        f.licence_expiry ? expiryColour(f.licence_expiry) : ''
                      )}
                    >
                      {f.licence_expiry ? fmtDate(f.licence_expiry) : '—'}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {f.waste_types ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={f.active ? 'active' : 'archived'} />
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingFacility(f)
                              setFacilityDialog(true)
                            }}
                            aria-label={`Edit ${f.name}`}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleDeleteFacility(f)}
                              aria-label={`Delete ${f.name}`}
                            >
                              <Trash2Icon className="size-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Permits */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Project permits &amp; allowances</h2>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditingPermit(null)
                setPermitDialog(true)
              }}
            >
              <PlusIcon className="size-4" />
              Add permit
            </Button>
          )}
        </div>
        {permits.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            <FactoryIcon className="size-5 shrink-0" />
            No permits recorded. Add each project&apos;s disposal allowances so
            loads reconcile against them.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="text-right">Allowance</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Expiry</TableHead>
                  {canManage && <TableHead className="w-20" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {permits.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[160px] truncate text-sm">
                      <Link
                        href={`/projects/${p.project_id}/env`}
                        className="hover:underline"
                      >
                        {p.project_label}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px] text-sm font-medium">
                      <div className="flex flex-col">
                        <span className="truncate">{p.reference}</span>
                        {p.description && (
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {p.description}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {WASTE_CLASSIFICATION_LABELS[p.classification]}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {p.allowance_qty} {WASTE_UNIT_LABELS[p.allowance_unit]}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <PermitUsageBar usage={p.usage} />
                        {p.usage.otherUnitCount > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{p.usage.otherUnitCount} load
                            {p.usage.otherUnitCount === 1 ? '' : 's'} in the other
                            unit (not converted)
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-sm tabular-nums',
                        p.expiry ? expiryColour(p.expiry) : ''
                      )}
                    >
                      {p.expiry ? fmtDate(p.expiry) : '—'}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingPermit(p)
                              setPermitDialog(true)
                            }}
                            aria-label={`Edit ${p.reference}`}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleDeletePermit(p)}
                              aria-label={`Delete ${p.reference}`}
                            >
                              <Trash2Icon className="size-3.5 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {facilityDialog && (
        <FacilityDialog
          key={editingFacility?.id ?? 'new'}
          open={facilityDialog}
          onOpenChange={setFacilityDialog}
          existing={editingFacility ?? undefined}
        />
      )}
      {permitDialog && (
        <PermitDialog
          key={editingPermit?.id ?? 'new'}
          open={permitDialog}
          onOpenChange={setPermitDialog}
          projects={projects}
          existing={editingPermit ?? undefined}
        />
      )}
    </section>
  )
}
