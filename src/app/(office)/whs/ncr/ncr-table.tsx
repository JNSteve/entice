'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon, ClipboardCheckIcon, DownloadIcon } from 'lucide-react'
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
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import {
  NCR_SOURCES,
  NCR_SOURCE_LABELS,
  NCR_STATUSES,
  type NcrSource,
} from '@/lib/zod'
import { createNcr } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NcrRow {
  id: string
  number: string
  source: NcrSource
  severity: number
  title: string
  status: string
  raised_by_name: string | null
  occurred_on: string | null
  created_at: string
  project_id: string | null
  project_label: string | null
  job_id: string | null
  job_label: string | null
  vendor_label: string | null
  open_capa_count: number
  overdue_capa_count: number
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

// ─── Source badge ─────────────────────────────────────────────────────────────

const SOURCE_CLASSES: Record<NcrSource, string> = {
  quality:
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300',
  environmental:
    'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300',
  customer_complaint:
    'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300',
  audit_finding:
    'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  supplier:
    'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300',
  safety:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300',
  legal_compliance:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  other:
    'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

function SourceBadge({ source }: { source: NcrSource }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        SOURCE_CLASSES[source]
      )}
    >
      {NCR_SOURCE_LABELS[source]}
    </span>
  )
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

// ─── Raise NCR dialog (office-side) ───────────────────────────────────────────

interface RaiseNcrDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectOption[]
  jobs: JobOption[]
  vendors: VendorOption[]
}

function RaiseNcrDialog({
  open,
  onOpenChange,
  projects,
  jobs,
  vendors,
}: RaiseNcrDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    source: 'quality' as NcrSource,
    severity: '3',
    title: '',
    description: '',
    immediate_action: '',
    category: '',
    occurred_on: '',
    project_id: '',
    job_id: '',
    vendor_id: '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createNcr({
        ...form,
        category: form.category || null,
        immediate_action: form.immediate_action || null,
        occurred_on: form.occurred_on || null,
        project_id: form.project_id || null,
        job_id: form.job_id || null,
        vendor_id: form.vendor_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('NCR raised')
      onOpenChange(false)
      if (result.id) router.push(`/whs/ncr/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise NCR</DialogTitle>
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
              placeholder="Short summary of the nonconformance"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Category (optional)</Label>
              <Input
                value={form.category}
                onChange={(e) => field('category', e.target.value)}
                placeholder="e.g. Concrete, Materials"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Occurred on (optional)</Label>
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
              placeholder="What is nonconforming, and against what requirement?"
              rows={3}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Immediate action / containment</Label>
            <Textarea
              value={form.immediate_action}
              onChange={(e) => field('immediate_action', e.target.value)}
              placeholder="What was done immediately to contain it?"
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
              {pending ? 'Raising…' : 'Raise NCR'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main table ───────────────────────────────────────────────────────────────

interface NcrTableProps {
  ncrs: NcrRow[]
  projects: ProjectOption[]
  jobs: JobOption[]
  vendors: VendorOption[]
}

export function NcrTable({ ncrs, projects, jobs, vendors }: NcrTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)

  const filtered = ncrs.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (sourceFilter !== 'all' && row.source !== sourceFilter) return false
    if (projectFilter !== 'all' && row.project_id !== projectFilter) return false
    return true
  })

  const tabCounts = Object.fromEntries(
    ['all', ...NCR_STATUSES].map((s) => [
      s,
      s === 'all' ? ncrs.length : ncrs.filter((r) => r.status === s).length,
    ])
  )

  function exportCsv() {
    downloadCsv(
      'ncr-register.csv',
      filtered.map((r) => ({
        number: r.number,
        source: NCR_SOURCE_LABELS[r.source],
        severity: r.severity,
        title: r.title,
        status: r.status,
        project_or_job: r.project_label ?? r.job_label ?? r.vendor_label ?? '',
        open_capa: r.open_capa_count,
        overdue_capa: r.overdue_capa_count,
        raised_by: r.raised_by_name ?? '',
        occurred_on: r.occurred_on ?? '',
        raised_on: r.created_at.slice(0, 10),
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...NCR_STATUSES] as const).map((s) => (
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
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}{' '}
              <span className="text-xs opacity-70">{tabCounts[s]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {NCR_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {NCR_SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {projects.length > 0 && (
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
                    {p.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>

          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Raise NCR
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheckIcon className="size-8" />}
          title="No NCRs"
          description="No nonconformances match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">CAPA</TableHead>
                <TableHead>Raised by</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/whs/ncr/${row.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <Link
                      href={`/whs/ncr/${row.id}`}
                      className="truncate text-sm hover:underline"
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={row.source} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={row.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.open_capa_count > 0 ? (
                      <span
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          row.overdue_capa_count > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                        )}
                        title={
                          row.overdue_capa_count > 0
                            ? `${row.overdue_capa_count} overdue`
                            : undefined
                        }
                      >
                        {row.open_capa_count} open
                        {row.overdue_capa_count > 0 ? ' ⚠' : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.raised_by_name ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(row.occurred_on ?? row.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RaiseNcrDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects}
        jobs={jobs}
        vendors={vendors}
      />
    </div>
  )
}
