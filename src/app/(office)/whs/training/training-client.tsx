'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AwardIcon,
  DownloadIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserPlusIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/EmptyState'
import { CompetencyLight } from '@/components/CompetencyLight'
import { downloadCsv } from '@/lib/csv'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  COMPETENCY_STATUS_LABELS,
  defaultExpiry,
  deriveCompetencyStatus,
  latestRecords,
  workerTypeKey,
  type MatrixCellStatus,
} from '@/lib/competency'
import {
  COMPETENCY_CATEGORY_LABELS,
  WORKER_ROLES,
  WORKER_ROLE_LABELS,
  type CompetencyCategory,
  type WorkerRole,
} from '@/lib/zod'
import {
  createCompetencyRecord,
  deleteCompetencyRecord,
  upsertWorker,
} from './actions'

// ─── Row types (shaped by the server page) ────────────────────────────────────

export interface WorkerRow {
  id: string
  profile_id: string | null
  name: string
  company: string | null
  role: WorkerRole
  active: boolean
}

export interface TypeRow {
  id: string
  name: string
  category: CompetencyCategory
  validity_months: number | null
  active: boolean
}

export interface RecordRow {
  id: string
  number: string
  worker_id: string
  competency_type_id: string
  issuer: string | null
  reference_no: string | null
  issue_date: string
  expiry_date: string | null
  evidence_filename: string | null
  /** Signed URL (1h), generated server-side. Null when no evidence. */
  evidence_url: string | null
  superseded_by: string | null
  created_at: string
  created_by_name: string | null
}

export interface RequirementRow {
  id: string
  role: WorkerRole
  competency_type_id: string
  is_mandatory: boolean
}

interface TrainingClientProps {
  workers: WorkerRow[]
  types: TypeRow[]
  records: RecordRow[]
  requirements: RequirementRow[]
  /** AU (Brisbane) calendar day the derived statuses are computed against. */
  today: string
  canManage: boolean
  isAdmin: boolean
}

// ─── Add-record dialog ────────────────────────────────────────────────────────

function AddRecordDialog({
  open,
  workers,
  types,
  presetWorkerId,
  today,
  onClose,
}: {
  open: boolean
  workers: WorkerRow[]
  types: TypeRow[]
  presetWorkerId: string | null
  today: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [workerId, setWorkerId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [issuer, setIssuer] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [issueDate, setIssueDate] = useState(today)
  const [expiryDate, setExpiryDate] = useState('')
  const [expiryTouched, setExpiryTouched] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  // Fresh state each open (documents-dialog pattern).
  const [seedKey, setSeedKey] = useState<string | null>(null)
  const key = open ? (presetWorkerId ?? '__new') : null
  if (key !== seedKey) {
    setSeedKey(key)
    if (key !== null) {
      setWorkerId(presetWorkerId ?? '')
      setTypeId('')
      setIssuer('')
      setReferenceNo('')
      setIssueDate(today)
      setExpiryDate('')
      setExpiryTouched(false)
      setFile(null)
    }
  }

  const activeWorkers = workers.filter((w) => w.active)
  const activeTypes = types.filter((t) => t.active)
  const selectedType = types.find((t) => t.id === typeId) ?? null

  /** Prefill expiry from the type's validity unless the user has edited it. */
  function applyDefaultExpiry(nextTypeId: string, nextIssue: string) {
    if (expiryTouched) return
    const type = types.find((t) => t.id === nextTypeId)
    setExpiryDate(type ? (defaultExpiry(nextIssue, type.validity_months) ?? '') : '')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    const problem = f ? validateUploadFile(f) : null
    if (problem) {
      toast.error(problem)
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(f)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!workerId || !typeId) {
      toast.error('Pick a worker and a competency type')
      return
    }
    startTransition(async () => {
      let evidence: { evidence_path: string | null; evidence_filename: string | null } = {
        evidence_path: null,
        evidence_filename: null,
      }

      const supabase = createClient()

      if (file) {
        const path = buildStorageKey('competency', file.name)
        const { error: storageError } = await supabase.storage
          .from('attachments')
          .upload(path, file, {
            contentType: safeContentType(file.type),
            upsert: false,
          })
        if (storageError) {
          toast.error(storageError.message)
          return
        }
        evidence = { evidence_path: path, evidence_filename: file.name }
      }

      const result = await createCompetencyRecord({
        worker_id: workerId,
        competency_type_id: typeId,
        issuer,
        reference_no: referenceNo,
        issue_date: issueDate,
        expiry_date: expiryDate || null,
        ...evidence,
      })

      if (result.error) {
        if (evidence.evidence_path) {
          await removeUploadedObject(supabase, evidence.evidence_path)
        }
        toast.error(result.error)
        return
      }

      toast.success('Competency recorded — any previous record of this type is superseded')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record competency</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Recording a new ticket automatically supersedes the previous record
            of the same type for this worker.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>
              Worker <span className="text-destructive">*</span>
            </Label>
            <Select value={workerId} onValueChange={(v) => setWorkerId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a worker…" />
              </SelectTrigger>
              <SelectContent>
                {activeWorkers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.company ? ` (${w.company})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              Competency type <span className="text-destructive">*</span>
            </Label>
            <Select
              value={typeId}
              onValueChange={(v) => {
                const next = v ?? ''
                setTypeId(next)
                applyDefaultExpiry(next, issueDate)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a type…" />
              </SelectTrigger>
              <SelectContent>
                {activeTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedType && (
              <span className="text-xs text-muted-foreground">
                {COMPETENCY_CATEGORY_LABELS[selectedType.category]}
                {selectedType.validity_months
                  ? ` · valid ${selectedType.validity_months} months`
                  : ' · no expiry'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-issuer">Issuer / RTO</Label>
              <Input
                id="rec-issuer"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="e.g. WorkSafe QLD"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-ref">Reference / card no.</Label>
              <Input
                id="rec-ref"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-issue">
                Issue date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rec-issue"
                type="date"
                value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value)
                  applyDefaultExpiry(typeId, e.target.value)
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-expiry">Expiry (blank = never)</Label>
              <Input
                id="rec-expiry"
                type="date"
                value={expiryDate}
                min={issueDate}
                onChange={(e) => {
                  setExpiryTouched(true)
                  setExpiryDate(e.target.value)
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-file">Evidence (optional, max 25 MB)</Label>
            <Input id="rec-file" type="file" onChange={handleFileChange} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !workerId || !typeId}>
              {pending ? 'Saving…' : 'Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Worker add/edit dialog ───────────────────────────────────────────────────

function WorkerDialog({
  open,
  worker,
  onClose,
}: {
  open: boolean
  worker: WorkerRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState<WorkerRole>('field')
  const [active, setActive] = useState(true)

  const [seedKey, setSeedKey] = useState<string | null>(null)
  const key = open ? (worker?.id ?? '__new') : null
  if (key !== seedKey) {
    setSeedKey(key)
    if (key !== null) {
      setName(worker?.name ?? '')
      setCompany(worker?.company ?? '')
      setRole(worker?.role ?? 'field')
      setActive(worker?.active ?? true)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertWorker({
        id: worker?.id,
        name: name.trim(),
        company,
        role,
        active,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(worker ? 'Worker updated' : 'Worker added')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{worker ? 'Edit worker' : 'New worker'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!worker && (
            <p className="text-sm text-muted-foreground">
              Staff get a worker automatically from their user profile — add
              rows here for subcontractor individuals.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="worker-name">Name</Label>
            <Input
              id="worker-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="worker-company">
              Company{' '}
              <span className="text-xs font-normal text-muted-foreground">
                (blank = direct employee)
              </span>
            </Label>
            <Input
              id="worker-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role (drives required competencies)</Label>
            <Select value={role} onValueChange={(v) => setRole((v as WorkerRole) ?? 'field')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {WORKER_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active (shown on the matrix)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? 'Saving…' : worker ? 'Save' : 'Add worker'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Worker detail dialog ─────────────────────────────────────────────────────

function WorkerDetailDialog({
  worker,
  types,
  records,
  requirements,
  today,
  canManage,
  isAdmin,
  onAddRecord,
  onEditWorker,
  onDeleteRecord,
  busyId,
  onClose,
}: {
  worker: WorkerRow | null
  types: TypeRow[]
  records: RecordRow[]
  requirements: RequirementRow[]
  today: string
  canManage: boolean
  isAdmin: boolean
  onAddRecord: (workerId: string) => void
  onEditWorker: (worker: WorkerRow) => void
  onDeleteRecord: (record: RecordRow) => void
  busyId: string | null
  onClose: () => void
}) {
  const typeById = new Map(types.map((t) => [t.id, t]))
  const workerRecords = worker
    ? records.filter((r) => r.worker_id === worker.id)
    : []
  const latest = latestRecords(workerRecords)

  const required = worker
    ? requirements
        .filter(
          (req) =>
            req.role === worker.role &&
            (typeById.get(req.competency_type_id)?.active ?? false)
        )
        .map((req) => {
          const rec = latest.get(workerTypeKey(worker.id, req.competency_type_id))
          const status: MatrixCellStatus = rec
            ? deriveCompetencyStatus(rec.expiry_date, today)
            : 'missing'
          return {
            req,
            type: typeById.get(req.competency_type_id)!,
            rec: rec ?? null,
            status,
          }
        })
    : []

  return (
    <Dialog open={Boolean(worker)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{worker?.name}</DialogTitle>
        </DialogHeader>
        {worker && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary" className="capitalize">
                {WORKER_ROLE_LABELS[worker.role]}
              </Badge>
              <Badge variant="outline">
                {worker.company ?? 'Employee'}
              </Badge>
              {!worker.active && <Badge variant="outline">Inactive</Badge>}
            </div>

            {/* Required competencies for the role */}
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">
                Required for role — {WORKER_ROLE_LABELS[worker.role]}
              </h3>
              {required.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No competency requirements configured for this role.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {required.map(({ req, type, rec, status }) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <CompetencyLight status={status} />
                        <span className="truncate">{type.name}</span>
                        {!req.is_mandatory && (
                          <span className="text-xs text-muted-foreground">
                            (desirable)
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {rec
                          ? rec.expiry_date
                            ? `expires ${fmtDate(rec.expiry_date)}`
                            : 'no expiry'
                          : 'no record'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Record history */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Records</h3>
              {workerRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No competency records yet.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerRecords.map((r) => {
                        const superseded = r.superseded_by !== null
                        const status = deriveCompetencyStatus(r.expiry_date, today)
                        return (
                          <TableRow
                            key={r.id}
                            className={superseded ? 'text-muted-foreground' : undefined}
                          >
                            <TableCell className="text-xs tabular-nums">{r.number}</TableCell>
                            <TableCell className="text-sm">
                              {typeById.get(r.competency_type_id)?.name ?? '—'}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {fmtDate(r.issue_date)}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {r.expiry_date ? fmtDate(r.expiry_date) : '—'}
                            </TableCell>
                            <TableCell>
                              {superseded ? (
                                <Badge variant="outline">Superseded</Badge>
                              ) : (
                                <span className="flex items-center gap-1.5 text-xs">
                                  <CompetencyLight status={status} />
                                  {COMPETENCY_STATUS_LABELS[status]}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {r.evidence_url && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    title={`Evidence — ${r.evidence_filename ?? 'file'}`}
                                    render={
                                      <a
                                        href={r.evidence_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="Open evidence"
                                      />
                                    }
                                  >
                                    <FileTextIcon className="size-3.5" />
                                  </Button>
                                )}
                                {isAdmin && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    title="Delete"
                                    className="text-destructive hover:text-destructive"
                                    disabled={busyId === r.id}
                                    onClick={() => onDeleteRecord(r)}
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => onAddRecord(worker.id)}>
                <PlusIcon className="size-4" />
                Add record
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(`/api/pdf/competency/${worker.id}`, '_blank')
                }
              >
                <FileTextIcon className="size-4" />
                Competency report PDF
              </Button>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => onEditWorker(worker)}>
                  <PencilIcon className="size-4" />
                  Edit worker
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function TrainingClient({
  workers,
  types,
  records,
  requirements,
  today,
  canManage,
  isAdmin,
}: TrainingClientProps) {
  const [view, setView] = useState<'matrix' | 'register'>('matrix')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | MatrixCellStatus>('all')
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [showInactiveWorkers, setShowInactiveWorkers] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addPresetWorker, setAddPresetWorker] = useState<string | null>(null)
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false)
  const [editWorker, setEditWorker] = useState<WorkerRow | null>(null)
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers])
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const latest = useMemo(() => latestRecords(records), [records])

  // Matrix columns: the competency types required by at least one role.
  const matrixTypes = useMemo(() => {
    const ids = new Set(requirements.map((r) => r.competency_type_id))
    return types
      .filter((t) => t.active && ids.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [requirements, types])

  const requirementByRoleType = useMemo(() => {
    const map = new Map<string, RequirementRow>()
    for (const r of requirements) map.set(`${r.role}::${r.competency_type_id}`, r)
    return map
  }, [requirements])

  const matrixWorkers = useMemo(
    () =>
      workers.filter(
        (w) =>
          (showInactiveWorkers || w.active) &&
          (!search.trim() ||
            w.name.toLowerCase().includes(search.trim().toLowerCase()) ||
            (w.company ?? '').toLowerCase().includes(search.trim().toLowerCase()))
      ),
    [workers, search, showInactiveWorkers]
  )

  // Register rows.
  const registerRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records
      .filter((r) => (showSuperseded ? true : r.superseded_by === null))
      .map((r) => ({
        record: r,
        worker: workerById.get(r.worker_id) ?? null,
        type: typeById.get(r.competency_type_id) ?? null,
        status: deriveCompetencyStatus(r.expiry_date, today),
        superseded: r.superseded_by !== null,
      }))
      .filter(({ worker, type, record }) => {
        if (!q) return true
        return (
          (worker?.name ?? '').toLowerCase().includes(q) ||
          (type?.name ?? '').toLowerCase().includes(q) ||
          record.number.toLowerCase().includes(q) ||
          (record.reference_no ?? '').toLowerCase().includes(q)
        )
      })
      .filter(({ status, superseded }) =>
        statusFilter === 'all' ? true : !superseded && status === statusFilter
      )
  }, [records, workerById, typeById, today, search, statusFilter, showSuperseded])

  function cellFor(worker: WorkerRow, type: TypeRow) {
    const rec = latest.get(workerTypeKey(worker.id, type.id)) ?? null
    const req = requirementByRoleType.get(`${worker.role}::${type.id}`) ?? null
    return { rec, req }
  }

  function handleDeleteRecord(record: RecordRow) {
    if (
      !confirm(
        `Delete ${record.number}? Any record it superseded becomes current again. This cannot be undone.`
      )
    )
      return
    setBusyId(record.id)
    startTransition(async () => {
      const result = await deleteCompetencyRecord(record.id)
      setBusyId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Record deleted')
    })
  }

  function handleCsvExport() {
    downloadCsv(
      'competency-register.csv',
      registerRows.map(({ record, worker, type, status, superseded }) => ({
        number: record.number,
        worker: worker?.name ?? '',
        company: worker?.company ?? '',
        competency: type?.name ?? '',
        category: type ? COMPETENCY_CATEGORY_LABELS[type.category] : '',
        issuer: record.issuer ?? '',
        reference: record.reference_no ?? '',
        issued: fmtDate(record.issue_date),
        expiry: record.expiry_date ? fmtDate(record.expiry_date) : '',
        status: superseded ? 'superseded' : status,
        evidence: record.evidence_filename ?? '',
      }))
    )
  }

  const detailWorker = detailWorkerId ? workerById.get(detailWorkerId) ?? null : null

  return (
    <div className="flex flex-col gap-4">
      {/* View chips + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {(['matrix', 'register'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm capitalize transition-colors',
                view === v
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {v === 'matrix' ? 'Competency matrix' : 'Register'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/api/pdf/training-matrix/list', '_blank')}
          >
            <FileTextIcon className="size-4" />
            Matrix PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCsvExport}
            disabled={registerRows.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditWorker(null)
                setWorkerDialogOpen(true)
              }}
            >
              <UserPlusIcon className="size-4" />
              Add worker
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setAddPresetWorker(null)
              setAddOpen(true)
            }}
          >
            <PlusIcon className="size-4" />
            Add record
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            view === 'matrix' ? 'Search workers' : 'Search worker, type or number'
          }
          className="w-64"
        />
        {view === 'register' && (
          <>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter((v as 'all' | MatrixCellStatus) ?? 'all')
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="current">Current</SelectItem>
                <SelectItem value="expiring">Expiring ≤30 days</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4"
                checked={showSuperseded}
                onChange={(e) => setShowSuperseded(e.target.checked)}
              />
              Show superseded
            </label>
          </>
        )}
        {view === 'matrix' && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4"
              checked={showInactiveWorkers}
              onChange={(e) => setShowInactiveWorkers(e.target.checked)}
            />
            Show inactive workers
          </label>
        )}
      </div>

      {/* ── Matrix ── */}
      {view === 'matrix' &&
        (matrixWorkers.length === 0 ? (
          <EmptyState
            icon={<AwardIcon className="size-8" />}
            title="No workers"
            description="Workers are created automatically from staff profiles — add subbie individuals with “Add worker”."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Worker</TableHead>
                  {matrixTypes.map((t) => (
                    <TableHead
                      key={t.id}
                      className="min-w-24 text-center text-xs"
                      title={t.name}
                    >
                      {t.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixWorkers.map((w) => (
                  <TableRow key={w.id} className={!w.active ? 'text-muted-foreground' : undefined}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailWorkerId(w.id)}
                        className="flex flex-col text-left hover:underline"
                      >
                        <span className="text-sm font-medium">{w.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {WORKER_ROLE_LABELS[w.role]}
                          {w.company ? ` · ${w.company}` : ''}
                        </span>
                      </button>
                    </TableCell>
                    {matrixTypes.map((t) => {
                      const { rec, req } = cellFor(w, t)
                      if (!rec && !req) {
                        return (
                          <TableCell key={t.id} className="text-center text-muted-foreground/50">
                            ·
                          </TableCell>
                        )
                      }
                      const status: MatrixCellStatus = rec
                        ? deriveCompetencyStatus(rec.expiry_date, today)
                        : 'missing'
                      const title = rec
                        ? `${t.name}: ${COMPETENCY_STATUS_LABELS[status]}${
                            rec.expiry_date ? ` · expires ${fmtDate(rec.expiry_date)}` : ''
                          }`
                        : `${t.name}: no record${req?.is_mandatory ? ' (mandatory for role)' : ''}`
                      return (
                        <TableCell key={t.id} className="text-center">
                          <button
                            type="button"
                            onClick={() => setDetailWorkerId(w.id)}
                            className="inline-flex items-center justify-center"
                            aria-label={title}
                          >
                            <CompetencyLight
                              status={status}
                              title={title}
                              className={cn(
                                status === 'missing' && !req?.is_mandatory && 'opacity-50'
                              )}
                            />
                          </button>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}

      {/* Matrix legend */}
      {view === 'matrix' && matrixWorkers.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CompetencyLight status="current" /> Current
          </span>
          <span className="flex items-center gap-1.5">
            <CompetencyLight status="expiring" /> Expiring ≤30 days
          </span>
          <span className="flex items-center gap-1.5">
            <CompetencyLight status="expired" /> Expired
          </span>
          <span className="flex items-center gap-1.5">
            <CompetencyLight status="missing" /> Missing (required)
          </span>
          <span>· Not required for role</span>
        </div>
      )}

      {/* ── Register ── */}
      {view === 'register' &&
        (registerRows.length === 0 ? (
          <EmptyState
            icon={<AwardIcon className="size-8" />}
            title="No competency records"
            description="Record licences, tickets, VOCs and inductions with “Add record”."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Competency</TableHead>
                  <TableHead>Issuer</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registerRows.map(({ record, worker, type, status, superseded }) => (
                  <TableRow
                    key={record.id}
                    className={superseded ? 'text-muted-foreground' : undefined}
                  >
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {record.number}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailWorkerId(record.worker_id)}
                        className="text-left text-sm font-medium hover:underline"
                      >
                        {worker?.name ?? '—'}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm">{type?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {record.issuer ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {record.reference_no ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {fmtDate(record.issue_date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {record.expiry_date ? fmtDate(record.expiry_date) : '—'}
                    </TableCell>
                    <TableCell>
                      {superseded ? (
                        <Badge variant="outline">Superseded</Badge>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs">
                          <CompetencyLight status={status} />
                          {COMPETENCY_STATUS_LABELS[status]}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {record.evidence_url ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={`Evidence — ${record.evidence_filename ?? 'file'}`}
                            render={
                              <a
                                href={record.evidence_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open evidence"
                              />
                            }
                          >
                            <FileTextIcon className="size-3.5" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                            disabled={busyId === record.id}
                            onClick={() => handleDeleteRecord(record)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}

      {/* Dialogs */}
      <AddRecordDialog
        open={addOpen}
        workers={workers}
        types={types}
        presetWorkerId={addPresetWorker}
        today={today}
        onClose={() => {
          setAddOpen(false)
          setAddPresetWorker(null)
        }}
      />
      <WorkerDialog
        open={workerDialogOpen}
        worker={editWorker}
        onClose={() => {
          setWorkerDialogOpen(false)
          setEditWorker(null)
        }}
      />
      <WorkerDetailDialog
        worker={detailWorker}
        types={types}
        records={records}
        requirements={requirements}
        today={today}
        canManage={canManage}
        isAdmin={isAdmin}
        busyId={busyId}
        onAddRecord={(workerId) => {
          setAddPresetWorker(workerId)
          setAddOpen(true)
        }}
        onEditWorker={(w) => {
          setEditWorker(w)
          setWorkerDialogOpen(true)
        }}
        onDeleteRecord={handleDeleteRecord}
        onClose={() => setDetailWorkerId(null)}
      />
    </div>
  )
}
