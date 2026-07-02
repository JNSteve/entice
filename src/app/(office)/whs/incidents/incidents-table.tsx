'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon, AlertTriangleIcon } from 'lucide-react'
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
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'
import { nowAUInput } from '@/lib/tz-client'
import { cn } from '@/lib/utils'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  INCIDENT_STATUSES,
  type IncidentType,
} from '@/lib/zod'
import { createIncident } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncidentRow {
  id: string
  number: string
  type: IncidentType
  severity: number
  occurred_at: string
  location: string | null
  description: string
  status: string
  reported_by_name: string | null
  project_id: string | null
  project_label: string | null
  job_id: string | null
  job_label: string | null
  open_action_count: number
  overdue_action_count: number
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

// ─── Severity dots ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: number }) {
  const high = severity >= 4
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            'inline-block size-2 rounded-full',
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
          'ml-1 text-xs font-medium',
          high ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
        )}
      >
        {severity}
      </span>
    </div>
  )
}

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: IncidentType }) {
  const isEnvironmental = type === 'environmental'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        isEnvironmental
          ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300'
          : 'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
      )}
    >
      {INCIDENT_TYPE_LABELS[type]}
    </span>
  )
}

// ─── Create Incident Dialog ───────────────────────────────────────────────────

interface CreateIncidentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectOption[]
  jobs: JobOption[]
  profiles: ProfileOption[]
  currentProfileId: string
}

function CreateIncidentDialog({
  open,
  onOpenChange,
  projects,
  jobs,
  profiles,
  currentProfileId,
}: CreateIncidentDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    type: 'near_miss' as IncidentType,
    severity: '3',
    occurred_at: nowAUInput(),
    location: '',
    description: '',
    immediate_action: '',
    reported_by: currentProfileId,
    project_id: '',
    job_id: '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createIncident({
        ...form,
        project_id: form.project_id || null,
        job_id: form.job_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Incident created')
      onOpenChange(false)
      if (result.id) router.push(`/whs/incidents/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New incident</DialogTitle>
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
              placeholder="Site / area"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Project (optional)</Label>
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
              <Label>Job (optional)</Label>
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
              placeholder="What happened?"
              rows={3}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Immediate action taken</Label>
            <Textarea
              value={form.immediate_action}
              onChange={(e) => field('immediate_action', e.target.value)}
              placeholder="What was done immediately?"
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
              {pending ? 'Creating…' : 'Create incident'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main table ───────────────────────────────────────────────────────────────

interface IncidentsTableProps {
  incidents: IncidentRow[]
  projects: ProjectOption[]
  jobs: JobOption[]
  profiles: ProfileOption[]
  currentProfileId: string
}

export function IncidentsTable({
  incidents,
  projects,
  jobs,
  profiles,
  currentProfileId,
}: IncidentsTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)

  const filtered = incidents.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (typeFilter !== 'all' && row.type !== typeFilter) return false
    if (projectFilter !== 'all' && row.project_id !== projectFilter) return false
    return true
  })

  const tabCounts = Object.fromEntries(
    ['all', ...INCIDENT_STATUSES].map((s) => [
      s,
      s === 'all'
        ? incidents.length
        : incidents.filter((r) => r.status === s).length,
    ])
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status tabs */}
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...INCIDENT_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                statusFilter === s
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {s === 'all'
                ? 'All'
                : s.charAt(0).toUpperCase() + s.slice(1)}{' '}
              <span className="text-xs opacity-70">{tabCounts[s]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Type filter */}
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? 'all')}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {INCIDENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {INCIDENT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Project filter */}
          {projects.length > 0 && (
            <Select value={projectFilter} onValueChange={(v) => setProjectFilter(v ?? 'all')}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            New incident
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<AlertTriangleIcon className="size-8" />}
          title="No incidents"
          description="No incidents match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Project / Job</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reported by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/whs/incidents/${row.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TypeBadge type={row.type} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={row.severity} />
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    {row.project_id ? (
                      <Link
                        href={`/projects/${row.project_id}`}
                        className="truncate text-sm hover:underline"
                      >
                        {row.project_label ?? '—'}
                      </Link>
                    ) : row.job_id ? (
                      <Link
                        href={`/jobs/${row.job_id}`}
                        className="truncate text-sm hover:underline"
                      >
                        {row.job_label ?? '—'}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(row.occurred_at)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.reported_by_name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.open_action_count > 0 ? (
                      <span
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          row.overdue_action_count > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                        )}
                        title={
                          row.overdue_action_count > 0
                            ? `${row.overdue_action_count} overdue`
                            : undefined
                        }
                      >
                        {row.open_action_count} action
                        {row.open_action_count === 1 ? '' : 's'}
                        {row.overdue_action_count > 0 ? ' ⚠' : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateIncidentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects}
        jobs={jobs}
        profiles={profiles}
        currentProfileId={currentProfileId}
      />
    </div>
  )
}
