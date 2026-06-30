'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { parseISO, differenceInCalendarDays } from 'date-fns'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/StatusBadge'
import { PhotoUpload } from '@/components/PhotoUpload'
import { AttachmentList, type AttachmentItem } from '@/components/AttachmentList'
import { AuditHistory } from '@/components/AuditHistory'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AuditRow } from '@/lib/audit-queries'
import {
  NCR_SOURCES,
  NCR_SOURCE_LABELS,
  CAPA_KINDS,
  CAPA_KIND_LABELS,
  type NcrSource,
  type NcrStatus,
  type CapaKind,
} from '@/lib/zod'
import {
  setNcrStatus,
  updateNcr,
  createCapaAction,
  updateCapaAction,
  deleteCapaAction,
  markCapaActionDone,
  reopenCapaAction,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NcrDetailData {
  id: string
  number: string
  source: NcrSource
  category: string | null
  severity: number
  title: string
  description: string
  immediate_action: string | null
  root_cause: string | null
  status: NcrStatus
  occurred_on: string | null
  raised_by_name: string | null
  verification_notes: string | null
  verified_by_name: string | null
  verified_at: string | null
  closed_at: string | null
  project_id: string | null
  project_label: string | null
  job_id: string | null
  job_label: string | null
  vendor_id: string | null
  vendor_label: string | null
  incident_id: string | null
  incident_number: string | null
}

export interface CapaActionRow {
  id: string
  ncr_id: string
  kind: CapaKind
  description: string
  assigned_to: string | null
  assigned_to_name: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

export interface ProjectOption {
  id: string
  number: string
  name: string
}

export interface JobOption {
  id: string
  number: string
  title: string
}

export interface VendorOption {
  id: string
  name: string
}

export interface ProfileOption {
  id: string
  full_name: string
}

export interface NcrDetailClientProps {
  ncr: NcrDetailData
  actions: CapaActionRow[]
  attachments: AttachmentItem[]
  role: string
  profiles: ProfileOption[]
  projects: ProjectOption[]
  jobs: JobOption[]
  vendors: VendorOption[]
  auditHistory: AuditRow[]
}

// ─── Severity dots ────────────────────────────────────────────────────────────

function SeverityDots({ severity }: { severity: number }) {
  const high = severity >= 4
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            'inline-block size-2.5 rounded-full',
            i <= severity
              ? high
                ? 'bg-red-500'
                : 'bg-amber-500'
              : 'bg-gray-200 dark:bg-gray-700'
          )}
        />
      ))}
      <span
        className={cn(
          'ml-1 text-sm font-medium',
          high ? 'text-red-600 dark:text-red-400' : ''
        )}
      >
        {severity}/5
      </span>
    </div>
  )
}

// ─── Edit NCR dialog ──────────────────────────────────────────────────────────

interface EditNcrDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ncr: NcrDetailData
  projects: ProjectOption[]
  jobs: JobOption[]
  vendors: VendorOption[]
}

function EditNcrDialog({
  open,
  onOpenChange,
  ncr,
  projects,
  jobs,
  vendors,
}: EditNcrDialogProps) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    source: ncr.source,
    severity: String(ncr.severity),
    title: ncr.title,
    category: ncr.category ?? '',
    description: ncr.description,
    immediate_action: ncr.immediate_action ?? '',
    root_cause: ncr.root_cause ?? '',
    occurred_on: ncr.occurred_on ?? '',
    project_id: ncr.project_id ?? '',
    job_id: ncr.job_id ?? '',
    vendor_id: ncr.vendor_id ?? '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateNcr(ncr.id, {
        ...form,
        category: form.category || null,
        immediate_action: form.immediate_action || null,
        root_cause: form.root_cause || null,
        occurred_on: form.occurred_on || null,
        project_id: form.project_id || null,
        job_id: form.job_id || null,
        vendor_id: form.vendor_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('NCR updated')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit NCR</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Source</Label>
              <Select
                value={form.source}
                onValueChange={(v) => v && field('source', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NCR_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {NCR_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Severity (1–5)</Label>
              <Select
                value={form.severity}
                onValueChange={(v) => v && field('severity', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {n >= 4 ? '— High' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => field('title', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Input
                value={form.category}
                onChange={(e) => field('category', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Occurred on</Label>
              <Input
                type="date"
                value={form.occurred_on}
                onChange={(e) => field('occurred_on', e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              rows={3}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Immediate action / containment</Label>
            <Textarea
              value={form.immediate_action}
              onChange={(e) => field('immediate_action', e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Root cause</Label>
            <Textarea
              value={form.root_cause}
              onChange={(e) => field('root_cause', e.target.value)}
              placeholder="Identified during investigation"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select
                value={form.project_id}
                onValueChange={(v) => {
                  field('project_id', !v || v === '__none' ? '' : v)
                  field('job_id', '')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.number} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Job</Label>
              <Select
                value={form.job_id}
                onValueChange={(v) => {
                  field('job_id', !v || v === '__none' ? '' : v)
                  field('project_id', '')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.number} — {j.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Vendor</Label>
              <Select
                value={form.vendor_id}
                onValueChange={(v) =>
                  field('vendor_id', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {vendors.map((vd) => (
                    <SelectItem key={vd.id} value={vd.id}>
                      {vd.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── CAPA action dialog ───────────────────────────────────────────────────────

interface CapaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ncrId: string
  action?: CapaActionRow
  profiles: ProfileOption[]
}

function CapaDialog({
  open,
  onOpenChange,
  ncrId,
  action,
  profiles,
}: CapaDialogProps) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    kind: (action?.kind ?? 'corrective') as CapaKind,
    description: action?.description ?? '',
    assigned_to: action?.assigned_to ?? '',
    due_date: action?.due_date ?? '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        kind: form.kind,
        description: form.description,
        assigned_to: form.assigned_to || null,
        due_date: form.due_date || null,
      }
      const result = action
        ? await updateCapaAction(action.id, ncrId, payload)
        : await createCapaAction({ ...payload, ncr_id: ncrId })

      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(action ? 'Action updated' : 'Action added')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action ? 'Edit CAPA action' : 'Add CAPA action'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Kind</Label>
            <Select
              value={form.kind}
              onValueChange={(v) => v && field('kind', v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPA_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CAPA_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              rows={3}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Assigned to</Label>
              <Select
                value={form.assigned_to}
                onValueChange={(v) =>
                  field('assigned_to', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => field('due_date', e.target.value)}
              />
            </div>
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
              {pending ? 'Saving…' : action ? 'Save' : 'Add action'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Verify dialog (effectiveness gate) ───────────────────────────────────────

interface VerifyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ncrId: string
  openCapaCount: number
}

function VerifyDialog({
  open,
  onOpenChange,
  ncrId,
  openCapaCount,
}: VerifyDialogProps) {
  const [pending, startTransition] = useTransition()
  const [notes, setNotes] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await setNcrStatus(ncrId, {
        status: 'verified',
        verification_notes: notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Effectiveness verified')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify effectiveness</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {openCapaCount > 0 && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {openCapaCount} CAPA action{openCapaCount === 1 ? '' : 's'} still
              open. All actions must be marked done before you can verify
              effectiveness.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Verification of effectiveness</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How was it confirmed the actions were effective and the nonconformance will not recur?"
              rows={4}
              required
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
            <Button type="submit" disabled={pending || openCapaCount > 0}>
              {pending ? 'Verifying…' : 'Verify effectiveness'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NcrDetailClient({
  ncr,
  actions,
  attachments,
  role,
  profiles,
  projects,
  jobs,
  vendors,
  auditHistory,
}: NcrDetailClientProps) {
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [capaDialogOpen, setCapaDialogOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [editingCapa, setEditingCapa] = useState<CapaActionRow | undefined>(
    undefined
  )

  const today = new Date().toISOString().slice(0, 10)
  const isAdmin = role === 'admin'
  const canManage = role === 'admin' || role === 'office' || role === 'supervisor'

  const openCapaCount = actions.filter((a) => a.status === 'open').length

  function doStatusTransition(newStatus: NcrStatus) {
    startTransition(async () => {
      const result = await setNcrStatus(ncr.id, { status: newStatus })
      if (result.error) toast.error(result.error)
      else toast.success(`NCR moved to ${newStatus}`)
    })
  }

  function doToggleAction(action: CapaActionRow) {
    startTransition(async () => {
      const result =
        action.status === 'done'
          ? await reopenCapaAction(action.id, ncr.id)
          : await markCapaActionDone(action.id, ncr.id)
      if (result.error) toast.error(result.error)
    })
  }

  function doDeleteAction(action: CapaActionRow) {
    if (!confirm('Delete this CAPA action?')) return
    startTransition(async () => {
      const result = await deleteCapaAction(action.id, ncr.id)
      if (result.error) toast.error(result.error)
      else toast.success('Action deleted')
    })
  }

  const meta = [
    { label: 'Source', value: NCR_SOURCE_LABELS[ncr.source] },
    { label: 'Category', value: ncr.category ?? '—' },
    { label: 'Severity', value: <SeverityDots severity={ncr.severity} /> },
    { label: 'Status', value: <StatusBadge status={ncr.status} /> },
    {
      label: 'Occurred',
      value: ncr.occurred_on ? fmtDate(ncr.occurred_on) : '—',
    },
    {
      label: 'Project / Job / Vendor',
      value: ncr.project_id ? (
        <Link href={`/projects/${ncr.project_id}`} className="hover:underline">
          {ncr.project_label}
        </Link>
      ) : ncr.job_id ? (
        <Link href={`/jobs/${ncr.job_id}`} className="hover:underline">
          {ncr.job_label}
        </Link>
      ) : ncr.vendor_id ? (
        <Link href={`/vendors/${ncr.vendor_id}`} className="hover:underline">
          {ncr.vendor_label}
        </Link>
      ) : (
        '—'
      ),
    },
    { label: 'Raised by', value: ncr.raised_by_name ?? '—' },
    {
      label: 'Linked incident',
      value: ncr.incident_id ? (
        <Link
          href={`/whs/incidents/${ncr.incident_id}`}
          className="hover:underline"
        >
          {ncr.incident_number ?? 'Incident'}
        </Link>
      ) : (
        '—'
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold">{ncr.number}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {NCR_SOURCE_LABELS[ncr.source]} — {ncr.title}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && ncr.status === 'open' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('investigating')}
            >
              Start investigation
            </Button>
          )}
          {canManage && ncr.status === 'investigating' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('actions')}
            >
              Move to actions
            </Button>
          )}
          {canManage && ncr.status === 'actions' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setVerifyOpen(true)}
            >
              <ShieldCheckIcon className="mr-1 size-3.5" />
              Verify effectiveness
            </Button>
          )}
          {canManage && ncr.status === 'verified' && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => doStatusTransition('closed')}
            >
              Close NCR
            </Button>
          )}
          {ncr.status === 'closed' && isAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('verified')}
            >
              <RotateCcwIcon className="mr-1 size-3.5" />
              Reopen
            </Button>
          )}
          {canManage && ncr.status !== 'closed' && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon className="mr-1 size-3.5" />
              Edit
            </Button>
          )}
          <a href={`/api/pdf/ncr/${ncr.id}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">
              PDF
            </Button>
          </a>
        </div>
      </div>

      {/* Details card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {meta.map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">
                  {m.label}
                </dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-1 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Description
            </p>
            <p className="whitespace-pre-wrap text-sm">{ncr.description}</p>
          </div>
          {ncr.immediate_action && (
            <div className="flex flex-col gap-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Immediate action / containment
              </p>
              <p className="whitespace-pre-wrap text-sm">
                {ncr.immediate_action}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Root cause
            </p>
            <p className="whitespace-pre-wrap text-sm">
              {ncr.root_cause ?? (
                <span className="text-muted-foreground">
                  Not yet identified — capture during investigation.
                </span>
              )}
            </p>
          </div>
          {ncr.closed_at && (
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Closed {fmtDate(ncr.closed_at)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CAPA actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              CAPA actions
            </CardTitle>
            {canManage && ncr.status !== 'closed' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingCapa(undefined)
                  setCapaDialogOpen(true)
                }}
              >
                <PlusIcon className="mr-1 size-3.5" />
                Add action
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No CAPA actions yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.map((action) => {
                    const overdue =
                      action.status === 'open' &&
                      action.due_date != null &&
                      action.due_date < today
                    const daysOverdue = overdue
                      ? differenceInCalendarDays(
                          new Date(),
                          parseISO(action.due_date!)
                        )
                      : 0
                    return (
                      <TableRow key={action.id}>
                        <TableCell>
                          <span className="text-xs font-medium text-muted-foreground">
                            {CAPA_KIND_LABELS[action.kind]}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[240px] text-sm">
                          {action.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {action.assigned_to_name ?? '—'}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'text-sm tabular-nums',
                              overdue
                                ? 'font-medium text-red-600 dark:text-red-400'
                                : 'text-muted-foreground'
                            )}
                          >
                            {action.due_date ? fmtDate(action.due_date) : '—'}
                            {overdue ? ` (${daysOverdue}d overdue)` : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={action.status} />
                          {action.completed_at && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {fmtDate(action.completed_at)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title={
                                  action.status === 'done'
                                    ? 'Reopen'
                                    : 'Mark done'
                                }
                                disabled={pending}
                                onClick={() => doToggleAction(action)}
                              >
                                {action.status === 'done' ? (
                                  <RotateCcwIcon className="size-3.5" />
                                ) : (
                                  <CheckIcon className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="Edit"
                                onClick={() => {
                                  setEditingCapa(action)
                                  setCapaDialogOpen(true)
                                }}
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="Delete"
                                disabled={pending}
                                onClick={() => doDeleteAction(action)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2Icon className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification of effectiveness */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Verification of effectiveness
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ncr.verification_notes ? (
            <div className="flex flex-col gap-1">
              <p className="whitespace-pre-wrap text-sm">
                {ncr.verification_notes}
              </p>
              <p className="text-xs text-muted-foreground">
                Verified by {ncr.verified_by_name ?? '—'}
                {ncr.verified_at ? ` · ${fmtDate(ncr.verified_at)}` : ''}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not yet verified. An NCR cannot be closed until effectiveness is
              verified and all CAPA actions are done.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Photos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ncr.status !== 'closed' && (
            <PhotoUpload
              parentType="ncr"
              parentId={ncr.id}
              kind="photo"
              multiple
            />
          )}
          {attachments.length > 0 && (
            <AttachmentList items={attachments} canDelete={canManage} />
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">History</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditHistory rows={auditHistory} />
        </CardContent>
      </Card>

      {/* Dialogs */}
      <EditNcrDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        ncr={ncr}
        projects={projects}
        jobs={jobs}
        vendors={vendors}
      />
      <CapaDialog
        key={editingCapa?.id ?? 'new'}
        open={capaDialogOpen}
        onOpenChange={(open) => {
          setCapaDialogOpen(open)
          if (!open) setEditingCapa(undefined)
        }}
        ncrId={ncr.id}
        action={editingCapa}
        profiles={profiles}
      />
      <VerifyDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        ncrId={ncr.id}
        openCapaCount={openCapaCount}
      />
    </div>
  )
}
