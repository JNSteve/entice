'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  DownloadIcon,
  FileTextIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
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
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { todayAUClient } from '@/lib/tz-client'
import { gatingWarnings, type WasteUnit } from '@/lib/env'
import {
  WASTE_CLASSIFICATIONS,
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNITS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import { createWasteLoad, updateWasteLoad, deleteWasteLoad } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WasteLoadRow {
  id: string
  number: string
  date: string
  project_id: string | null
  job_id: string | null
  target_label: string
  classification: WasteClassification
  classification_detail: string | null
  qty: number
  unit: WasteUnitKey
  facility_id: string | null
  facility_name: string | null
  permit_id: string | null
  permit_ref: string | null
  transporter: string | null
  docket_ref: string | null
  notes: string | null
  override_reason: string | null
  created_by_name: string | null
}

export interface EnvTargetOption {
  id: string
  label: string
}

export interface FacilityOption {
  id: string
  name: string
  licence_expiry: string | null
  active: boolean
}

export interface PermitOption {
  id: string
  project_id: string
  reference: string
  classification: WasteClassification
  allowance_qty: number
  allowance_unit: WasteUnitKey
  expiry: string | null
}

// ─── Load create/edit dialog (gating = WARN + override reason, never block) ───

const emptyForm = {
  project_id: '',
  job_id: '',
  date: '',
  classification: 'general' as WasteClassification,
  classification_detail: '',
  qty: '',
  unit: 't' as WasteUnitKey,
  facility_id: '',
  permit_id: '',
  transporter: '',
  docket_ref: '',
  notes: '',
  override_reason: '',
}

export function WasteLoadDialog({
  open,
  onOpenChange,
  projects,
  jobs,
  facilities,
  permits,
  allLoads,
  lockedProject,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: EnvTargetOption[]
  jobs: EnvTargetOption[]
  facilities: FacilityOption[]
  permits: PermitOption[]
  /** Loads already booked (for permit usage-so-far in the gating check). */
  allLoads: WasteLoadRow[]
  /** Set on the project Environment tab — the load is scoped to this project. */
  lockedProject?: EnvTargetOption
  /** When set the dialog edits this load instead of creating one. */
  existing?: WasteLoadRow
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState(() =>
    existing
      ? {
          project_id: existing.project_id ?? '',
          job_id: existing.job_id ?? '',
          date: existing.date,
          classification: existing.classification,
          classification_detail: existing.classification_detail ?? '',
          qty: String(existing.qty),
          unit: existing.unit,
          facility_id: existing.facility_id ?? '',
          permit_id: existing.permit_id ?? '',
          transporter: existing.transporter ?? '',
          docket_ref: existing.docket_ref ?? '',
          notes: existing.notes ?? '',
          override_reason: existing.override_reason ?? '',
        }
      : {
          ...emptyForm,
          project_id: lockedProject?.id ?? '',
          date: todayAUClient(),
        }
  )

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const projectId = lockedProject?.id ?? form.project_id
  const projectPermits = permits.filter((p) => p.project_id === projectId)
  const selectedPermit =
    projectPermits.find((p) => p.id === form.permit_id) ?? null
  const selectedFacility =
    facilities.find((f) => f.id === form.facility_id) ?? null

  // Gating check: WARN + require an override reason — never a hard block.
  // Cheap pure computation — recomputed per render (React Compiler memoises).
  const qtyNumber = Number(form.qty)
  const warnings = gatingWarnings({
    facility: selectedFacility
      ? {
          name: selectedFacility.name,
          licence_expiry: selectedFacility.licence_expiry,
          active: selectedFacility.active,
        }
      : null,
    permit: selectedPermit
      ? {
          reference: selectedPermit.reference,
          expiry: selectedPermit.expiry,
          classification: selectedPermit.classification,
          allowance_qty: selectedPermit.allowance_qty,
          allowance_unit: selectedPermit.allowance_unit as WasteUnit,
        }
      : null,
    permitLoadsSoFar: selectedPermit
      ? allLoads
          .filter(
            (l) => l.permit_id === selectedPermit.id && l.id !== existing?.id
          )
          .map((l) => ({ qty: l.qty, unit: l.unit as WasteUnit }))
      : [],
    load: {
      classification: form.classification,
      qty: Number.isFinite(qtyNumber) ? qtyNumber : 0,
      unit: form.unit as WasteUnit,
    },
    today: todayAUClient(),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (warnings.length > 0 && !form.override_reason.trim()) {
      toast.error('Add an override reason to proceed despite the warnings')
      return
    }
    const payload = {
      project_id: (lockedProject?.id ?? form.project_id) || null,
      job_id: lockedProject ? null : form.job_id || null,
      date: form.date,
      classification: form.classification,
      classification_detail: form.classification_detail || null,
      qty: form.qty,
      unit: form.unit,
      facility_id: form.facility_id || null,
      permit_id: form.permit_id || null,
      transporter: form.transporter || null,
      vendor_id: null,
      docket_ref: form.docket_ref || null,
      notes: form.notes || null,
      override_reason: warnings.length > 0 ? form.override_reason : null,
    }
    startTransition(async () => {
      if (existing) {
        const result = await updateWasteLoad(existing.id, payload)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Waste load updated')
        onOpenChange(false)
        router.refresh()
        return
      }
      const result = await createWasteLoad(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Waste load ${result.number ?? ''} logged`)
      onOpenChange(false)
      if (result.id) router.push(`/whs/env/loads/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? `Edit ${existing.number}`
              : `Log waste load${lockedProject ? ` — ${lockedProject.label}` : ''}`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!lockedProject && !existing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Project</Label>
                <Select
                  value={form.project_id || '__none'}
                  onValueChange={(v) => {
                    field('project_id', !v || v === '__none' ? '' : v)
                    if (v && v !== '__none') field('job_id', '')
                    field('permit_id', '')
                  }}
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
              <div className="flex flex-col gap-1.5">
                <Label>or Job</Label>
                <Select
                  value={form.job_id || '__none'}
                  onValueChange={(v) => {
                    field('job_id', !v || v === '__none' ? '' : v)
                    if (v && v !== '__none') {
                      field('project_id', '')
                      field('permit_id', '')
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => field('date', e.target.value)}
                required
              />
            </div>
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Classification detail</Label>
            <Input
              value={form.classification_detail}
              onChange={(e) => field('classification_detail', e.target.value)}
              placeholder="e.g. Cat A friable ACM, bonded sheeting, VENM"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Quantity</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={form.qty}
                onChange={(e) => field('qty', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <Select value={form.unit} onValueChange={(v) => v && field('unit', v)}>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Receiving facility</Label>
              <Select
                value={form.facility_id || '__none'}
                onValueChange={(v) =>
                  field('facility_id', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Permit</Label>
              <Select
                value={form.permit_id || '__none'}
                onValueChange={(v) =>
                  field('permit_id', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {projectPermits.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.reference} ({WASTE_CLASSIFICATION_LABELS[p.classification]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Transporter</Label>
              <Input
                value={form.transporter}
                onChange={(e) => field('transporter', e.target.value)}
                placeholder="Carrier / truck"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Docket reference</Label>
              <Input
                value={form.docket_ref}
                onChange={(e) => field('docket_ref', e.target.value)}
                placeholder="Weighbridge / tipping docket no."
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => field('notes', e.target.value)}
              rows={2}
            />
          </div>

          {warnings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex flex-col gap-1">
                  {warnings.map((w) => (
                    <p key={w} className="text-amber-800 dark:text-amber-200">
                      {w}
                    </p>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Override reason (required to proceed)</Label>
                <Textarea
                  value={form.override_reason}
                  onChange={(e) => field('override_reason', e.target.value)}
                  placeholder="Why is this load proceeding despite the warning?"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : existing ? 'Save' : 'Log load'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function WasteLoadsClient({
  loads,
  projects,
  jobs,
  facilities,
  permits,
  lockedProject,
  canManage,
}: {
  loads: WasteLoadRow[]
  projects: EnvTargetOption[]
  jobs: EnvTargetOption[]
  facilities: FacilityOption[]
  permits: PermitOption[]
  /** Set on the project Environment tab: pre-filtered to this project. */
  lockedProject?: EnvTargetOption
  /** admin/office/supervisor — shows the add button (field uses /field/waste). */
  canManage: boolean
}) {
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [classificationFilter, setClassificationFilter] = useState<string>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const filtered = useMemo(
    () =>
      loads.filter((l) => {
        if (projectFilter !== 'all' && l.project_id !== projectFilter) return false
        if (
          classificationFilter !== 'all' &&
          l.classification !== classificationFilter
        )
          return false
        if (fromDate && l.date < fromDate) return false
        if (toDate && l.date > toDate) return false
        return true
      }),
    [loads, projectFilter, classificationFilter, fromDate, toDate]
  )

  function exportCsv() {
    downloadCsv(
      lockedProject
        ? `waste-loads-${lockedProject.label.split(' ')[0]}.csv`
        : 'waste-loads.csv',
      filtered.map((l) => ({
        number: l.number,
        date: l.date,
        target: l.target_label,
        classification: WASTE_CLASSIFICATION_LABELS[l.classification],
        detail: l.classification_detail ?? '',
        qty: l.qty,
        unit: WASTE_UNIT_LABELS[l.unit],
        facility: l.facility_name ?? '',
        permit: l.permit_ref ?? '',
        transporter: l.transporter ?? '',
        docket_ref: l.docket_ref ?? '',
        notes: l.notes ?? '',
        override_reason: l.override_reason ?? '',
        logged_by: l.created_by_name ?? '',
      }))
    )
  }

  // Echo the active filters into the PDF export URL.
  const pdfParams = new URLSearchParams()
  if (lockedProject) pdfParams.set('project', lockedProject.id)
  else if (projectFilter !== 'all') pdfParams.set('project', projectFilter)
  if (classificationFilter !== 'all')
    pdfParams.set('classification', classificationFilter)
  if (fromDate) pdfParams.set('from', fromDate)
  if (toDate) pdfParams.set('to', toDate)
  const pdfHref = `/api/pdf/waste-loads/list${pdfParams.size > 0 ? `?${pdfParams}` : ''}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!lockedProject && (
            <Select
              value={projectFilter}
              onValueChange={(v) => setProjectFilter(v ?? 'all')}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={classificationFilter}
            onValueChange={(v) => setClassificationFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All classifications" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classifications</SelectItem>
              {WASTE_CLASSIFICATIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {WASTE_CLASSIFICATION_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-38"
            aria-label="From date"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-38"
            aria-label="To date"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={<a href={pdfHref} target="_blank" rel="noopener noreferrer" />}
          >
            <FileTextIcon className="size-4" />
            PDF
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <PlusIcon className="size-4" />
              Log load
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Trash2Icon className="size-8" />}
          title="No waste loads"
          description="Loads leaving site are logged here — every load is a numbered ISO 14001 record."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                {!lockedProject && <TableHead>Project / job</TableHead>}
                <TableHead>Classification</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Docket</TableHead>
                <TableHead>Permit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link
                      href={`/whs/env/loads/${l.id}`}
                      className="flex items-center gap-1.5 font-mono font-medium hover:underline"
                    >
                      {l.number}
                      {l.override_reason && (
                        <AlertTriangleIcon
                          className="size-3.5 text-amber-500"
                          aria-label="Logged with a gating override"
                        />
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {fmtDate(l.date)}
                  </TableCell>
                  {!lockedProject && (
                    <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                      {l.target_label}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col">
                      <span
                        className={cn(
                          'text-sm',
                          (l.classification === 'asbestos' ||
                            l.classification === 'regulated' ||
                            l.classification === 'contaminated_soil') &&
                            'font-medium text-amber-700 dark:text-amber-300'
                        )}
                      >
                        {WASTE_CLASSIFICATION_LABELS[l.classification]}
                      </span>
                      {l.classification_detail && (
                        <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {l.classification_detail}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {l.qty} {WASTE_UNIT_LABELS[l.unit]}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                    {l.facility_name ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.docket_ref ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.permit_ref ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogOpen && (
        <WasteLoadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projects={projects}
          jobs={jobs}
          facilities={facilities}
          permits={permits}
          allLoads={loads}
          lockedProject={lockedProject}
        />
      )}
    </div>
  )
}

// ─── Delete button (admin, load detail page) ─────────────────────────────────

export function DeleteWasteLoadButton({ loadId }: { loadId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Delete this waste load record? This cannot be undone.')) return
    startTransition(async () => {
      const result = await deleteWasteLoad(loadId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Waste load deleted')
      router.push('/whs/env')
    })
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDelete} disabled={pending}>
      <Trash2Icon className="size-4 text-destructive" />
      Delete
    </Button>
  )
}

// ─── Edit button wrapper (load detail page) ──────────────────────────────────

export function EditWasteLoadButton({
  load,
  projects,
  jobs,
  facilities,
  permits,
  allLoads,
}: {
  load: WasteLoadRow
  projects: EnvTargetOption[]
  jobs: EnvTargetOption[]
  facilities: FacilityOption[]
  permits: PermitOption[]
  allLoads: WasteLoadRow[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <WasteLoadDialog
          open={open}
          onOpenChange={setOpen}
          projects={projects}
          jobs={jobs}
          facilities={facilities}
          permits={permits}
          allLoads={allLoads}
          existing={load}
        />
      )}
    </>
  )
}
