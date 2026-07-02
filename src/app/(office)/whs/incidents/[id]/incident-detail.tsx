'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  RotateCcwIcon,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { todayAUClient } from '@/lib/tz-client'
import { cn } from '@/lib/utils'
import type { AuditRow } from '@/lib/audit-queries'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  type IncidentType,
  type IncidentStatus,
} from '@/lib/zod'
import {
  setIncidentStatus,
  updateIncident,
  createCorrectiveAction,
  updateCorrectiveAction,
  deleteCorrectiveAction,
  markCorrectiveActionDone,
  reopenCorrectiveAction,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncidentDetailData {
  id: string
  number: string
  type: IncidentType
  severity: number
  occurred_at: string
  location: string | null
  description: string
  immediate_action: string | null
  reported_by: string | null
  reported_by_name: string | null
  status: IncidentStatus
  closed_at: string | null
  project_id: string | null
  project_label: string | null
  job_id: string | null
  job_label: string | null
}

export interface CorrectiveActionRow {
  id: string
  incident_id: string
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

export interface ProfileOption {
  id: string
  full_name: string
}

export interface IncidentDetailClientProps {
  incident: IncidentDetailData
  actions: CorrectiveActionRow[]
  attachments: AttachmentItem[]
  role: string
  profiles: ProfileOption[]
  projects: ProjectOption[]
  jobs: JobOption[]
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

// ─── Edit incident dialog ─────────────────────────────────────────────────────

interface EditIncidentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  incident: IncidentDetailData
  projects: ProjectOption[]
  jobs: JobOption[]
  profiles: ProfileOption[]
}

function EditIncidentDialog({
  open,
  onOpenChange,
  incident,
  projects,
  jobs,
  profiles,
}: EditIncidentDialogProps) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    type: incident.type,
    severity: String(incident.severity),
    occurred_at: incident.occurred_at.slice(0, 16),
    location: incident.location ?? '',
    description: incident.description,
    immediate_action: incident.immediate_action ?? '',
    reported_by: incident.reported_by ?? '',
    project_id: incident.project_id ?? '',
    job_id: incident.job_id ?? '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateIncident(incident.id, {
        ...form,
        project_id: form.project_id || null,
        job_id: form.job_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Incident updated')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit incident</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => v && field('type', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {INCIDENT_TYPE_LABELS[t]}
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
            <Label>When it happened</Label>
            <Input
              type="datetime-local"
              value={form.occurred_at}
              onChange={(e) => field('occurred_at', e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Location</Label>
            <Input
              value={form.location}
              onChange={(e) => field('location', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <Label>Immediate action</Label>
            <Textarea
              value={form.immediate_action}
              onChange={(e) => field('immediate_action', e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Reported by</Label>
            <Select
              value={form.reported_by}
              onValueChange={(v) => v && field('reported_by', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select person" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

// ─── Corrective action dialog ─────────────────────────────────────────────────

interface CorrectiveActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  incidentId: string
  action?: CorrectiveActionRow
  profiles: ProfileOption[]
}

function CorrectiveActionDialog({
  open,
  onOpenChange,
  incidentId,
  action,
  profiles,
}: CorrectiveActionDialogProps) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
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
        description: form.description,
        assigned_to: form.assigned_to || null,
        due_date: form.due_date || null,
      }
      const result = action
        ? await updateCorrectiveAction(action.id, incidentId, payload)
        : await createCorrectiveAction({ ...payload, incident_id: incidentId })

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
            {action ? 'Edit corrective action' : 'Add corrective action'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

// ─── Main component ───────────────────────────────────────────────────────────

export function IncidentDetailClient({
  incident,
  actions,
  attachments,
  role,
  profiles,
  projects,
  jobs,
  auditHistory,
}: IncidentDetailClientProps) {
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [actionDialogOpen, setActionDialogOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<
    CorrectiveActionRow | undefined
  >(undefined)

  // AU calendar day, so overdue flags agree with the server-side registers.
  const today = todayAUClient()
  const isAdmin = role === 'admin'
  const canEdit = role === 'admin' || role === 'office'

  function doStatusTransition(newStatus: IncidentStatus) {
    startTransition(async () => {
      const result = await setIncidentStatus(incident.id, { status: newStatus })
      if (result.error) toast.error(result.error)
      else toast.success(`Incident moved to ${newStatus}`)
    })
  }

  function doToggleAction(action: CorrectiveActionRow) {
    startTransition(async () => {
      const result =
        action.status === 'done'
          ? await reopenCorrectiveAction(action.id, incident.id)
          : await markCorrectiveActionDone(action.id, incident.id)
      if (result.error) toast.error(result.error)
    })
  }

  function doDeleteAction(action: CorrectiveActionRow) {
    if (!confirm('Delete this corrective action?')) return
    startTransition(async () => {
      const result = await deleteCorrectiveAction(action.id, incident.id)
      if (result.error) toast.error(result.error)
      else toast.success('Action deleted')
    })
  }

  const meta = [
    {
      label: 'Type',
      value: INCIDENT_TYPE_LABELS[incident.type],
    },
    { label: 'Severity', value: <SeverityDots severity={incident.severity} /> },
    { label: 'Status', value: <StatusBadge status={incident.status} /> },
    {
      label: 'Occurred',
      value: incident.occurred_at
        ? format(parseISO(incident.occurred_at), 'dd/MM/yyyy HH:mm')
        : '—',
    },
    { label: 'Location', value: incident.location ?? '—' },
    {
      label: 'Project / Job',
      value: incident.project_id ? (
        <Link href={`/projects/${incident.project_id}`} className="hover:underline">
          {incident.project_label}
        </Link>
      ) : incident.job_id ? (
        <Link href={`/jobs/${incident.job_id}`} className="hover:underline">
          {incident.job_label}
        </Link>
      ) : (
        '—'
      ),
    },
    { label: 'Reported by', value: incident.reported_by_name ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold">{incident.number}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {INCIDENT_TYPE_LABELS[incident.type]} — Severity {incident.severity}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {incident.status === 'open' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('investigating')}
            >
              Start investigation
            </Button>
          )}
          {incident.status === 'investigating' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('closed')}
            >
              Close incident
            </Button>
          )}
          {incident.status === 'closed' && isAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('investigating')}
            >
              <RotateCcwIcon className="mr-1 size-3.5" />
              Reopen
            </Button>
          )}
          {canEdit && incident.status !== 'closed' && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon className="mr-1 size-3.5" />
              Edit
            </Button>
          )}
          <a
            href={`/api/pdf/incident/${incident.id}`}
            target="_blank"
            rel="noreferrer"
          >
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
            <p className="whitespace-pre-wrap text-sm">{incident.description}</p>
          </div>
          {incident.immediate_action && (
            <div className="flex flex-col gap-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Immediate action
              </p>
              <p className="whitespace-pre-wrap text-sm">
                {incident.immediate_action}
              </p>
            </div>
          )}
          {incident.closed_at && (
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Closed {fmtDate(incident.closed_at)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Photos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PhotoUpload
            parentType="incident"
            parentId={incident.id}
            kind="photo"
            multiple
          />
          {attachments.length > 0 && (
            <AttachmentList items={attachments} canDelete={canEdit} />
          )}
        </CardContent>
      </Card>

      {/* Corrective actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Corrective actions
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingAction(undefined)
                setActionDialogOpen(true)
              }}
            >
              <PlusIcon className="mr-1 size-3.5" />
              Add action
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No corrective actions yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
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
                    // Pure calendar-date maths against the AU 'today' string.
                    const daysOverdue = overdue
                      ? Math.round(
                          (Date.parse(`${today}T00:00:00Z`) -
                            Date.parse(`${action.due_date}T00:00:00Z`)) /
                            86_400_000
                        )
                      : 0
                    return (
                      <TableRow key={action.id}>
                        <TableCell className="max-w-[260px] text-sm">
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
                                setEditingAction(action)
                                setActionDialogOpen(true)
                              }}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                            {(role === 'admin' ||
                              role === 'office' ||
                              role === 'supervisor') && (
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
      <EditIncidentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        incident={incident}
        projects={projects}
        jobs={jobs}
        profiles={profiles}
      />
      <CorrectiveActionDialog
        key={editingAction?.id ?? 'new'}
        open={actionDialogOpen}
        onOpenChange={(open) => {
          setActionDialogOpen(open)
          if (!open) setEditingAction(undefined)
        }}
        incidentId={incident.id}
        action={editingAction}
        profiles={profiles}
      />
    </div>
  )
}
