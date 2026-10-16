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
import { todayAUClient } from '@/lib/tz-client'
import { cn } from '@/lib/utils'
import {
  NCR_CLASSIFICATIONS,
  NCR_CLASSIFICATION_SEVERITY,
  NCR_SOURCES,
  NCR_SOURCE_LABELS,
  NCR_STATUSES,
  type NcrClassification,
  type NcrSource,
} from '@/lib/zod'
import { createNcr } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

/** One line of the SMS-R-08 corrective action register. */
export interface NcrRow {
  id: string
  number: string
  classification: string | null
  /** 'YYYY-MM-DD': occurred_on, else the Brisbane day the record was entered. */
  raised_on: string
  source: NcrSource
  source_detail: string | null
  title: string
  description: string
  assigned_to_text: string | null
  due_date: string | null
  implemented: string | null
  verification_notes: string | null
  status: string
  /** Brisbane calendar day of closed_at. */
  closed_on: string | null
  project_id: string | null
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
  itp:
    'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
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

// ─── Register text ────────────────────────────────────────────────────────────

/** Long register text, clamped to two lines; the full text is on hover. */
function ClampedText({
  text,
  className,
}: {
  text: string | null
  className?: string
}) {
  if (!text) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn('line-clamp-2 whitespace-normal', className)}
      title={text}
    >
      {text}
    </span>
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
    classification: '',
    // Blank until picked — the server then takes it from the classification.
    severity: '',
    source: 'quality' as NcrSource,
    source_detail: '',
    title: '',
    description: '',
    immediate_action: '',
    category: '',
    occurred_on: todayAUClient(),
    assigned_to_text: '',
    due_date: '',
    project_id: '',
    job_id: '',
    vendor_id: '',
  })

  const classificationSeverity = form.classification
    ? NCR_CLASSIFICATION_SEVERITY[form.classification as NcrClassification]
    : null

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createNcr({
        ...form,
        classification: form.classification || null,
        severity: form.severity || null,
        source_detail: form.source_detail || null,
        category: form.category || null,
        immediate_action: form.immediate_action || null,
        occurred_on: form.occurred_on || null,
        assigned_to_text: form.assigned_to_text || null,
        due_date: form.due_date || null,
        project_id: form.project_id || null,
        job_id: form.job_id || null,
        vendor_id: form.vendor_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('CAR raised')
      onOpenChange(false)
      if (result.id) router.push(`/whs/ncr/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise CAR</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Classification</Label>
              <Select
                value={form.classification || null}
                onValueChange={(v) =>
                  field('classification', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not classified" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not classified</SelectItem>
                  {NCR_CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Severity (1–5)</Label>
              <Select
                value={form.severity || null}
                onValueChange={(v) => v && field('severity', v)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      classificationSeverity
                        ? `${classificationSeverity} — from classification`
                        : 'Select'
                    }
                  />
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
              <Label>Source detail (optional)</Label>
              <Input
                value={form.source_detail}
                onChange={(e) => field('source_detail', e.target.value)}
                placeholder="As written, e.g. internal audit"
              />
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
              <Label>Date raised</Label>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Assigned to (optional)</Label>
              <Input
                value={form.assigned_to_text}
                onChange={(e) => field('assigned_to_text', e.target.value)}
                placeholder="Name and position"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due date (optional)</Label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => field('due_date', e.target.value)}
              />
            </div>
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
              <Label>Supplier</Label>
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
              {pending ? 'Raising…' : 'Raise CAR'}
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
  /** AU (Brisbane) calendar day from the server, for the overdue flag. */
  today: string
  projects: ProjectOption[]
  jobs: JobOption[]
  vendors: VendorOption[]
}

export function NcrTable({
  ncrs,
  today,
  projects,
  jobs,
  vendors,
}: NcrTableProps) {
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
      'corrective-actions-register.csv',
      filtered.map((r) => ({
        car_no: r.number,
        classification: r.classification ?? '',
        date_raised: r.raised_on,
        source: r.source_detail ?? NCR_SOURCE_LABELS[r.source],
        title: r.title,
        description: r.description,
        assigned_to: r.assigned_to_text ?? '',
        due: r.due_date ?? '',
        implemented: r.implemented ?? '',
        verified: r.verification_notes ?? '',
        status: r.status,
        closed: r.closed_on ?? '',
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
            Raise CAR
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheckIcon className="size-8" />}
          title="No corrective actions"
          description="No corrective actions match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CAR no.</TableHead>
                <TableHead>Date raised</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Implemented</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Closed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const overdue =
                  row.status !== 'closed' &&
                  row.due_date != null &&
                  row.due_date < today
                // Pure calendar-date maths against the AU 'today' string.
                const daysOverdue = overdue
                  ? Math.round(
                      (Date.parse(`${today}T00:00:00Z`) -
                        Date.parse(`${row.due_date}T00:00:00Z`)) /
                        86_400_000
                    )
                  : 0
                return (
                  <TableRow key={row.id} className="text-xs">
                    <TableCell className="align-top">
                      <Link
                        href={`/whs/ncr/${row.id}`}
                        className="font-mono font-medium hover:underline"
                      >
                        {row.number}
                      </Link>
                      {row.classification && (
                        <div className="text-muted-foreground">
                          {row.classification}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top tabular-nums text-muted-foreground">
                      {fmtDate(row.raised_on)}
                    </TableCell>
                    <TableCell className="align-top">
                      {row.source_detail ? (
                        <ClampedText
                          text={row.source_detail}
                          className="min-w-[120px] max-w-[180px]"
                        />
                      ) : (
                        <SourceBadge source={row.source} />
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex min-w-[220px] max-w-[320px] flex-col whitespace-normal">
                        <Link
                          href={`/whs/ncr/${row.id}`}
                          className="line-clamp-2 font-medium hover:underline"
                        >
                          {row.title}
                        </Link>
                        <ClampedText
                          text={row.description}
                          className="text-muted-foreground"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <ClampedText
                        text={row.assigned_to_text}
                        className="min-w-[120px] max-w-[180px]"
                      />
                    </TableCell>
                    <TableCell className="align-top tabular-nums">
                      {row.due_date ? (
                        <div
                          className={cn(
                            'flex flex-col',
                            overdue
                              ? 'font-medium text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          <span>{fmtDate(row.due_date)}</span>
                          {overdue && (
                            <span>
                              {`${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <ClampedText
                        text={row.implemented}
                        className="min-w-[160px] max-w-[240px]"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <ClampedText
                        text={row.verification_notes}
                        className="min-w-[160px] max-w-[240px]"
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={row.status} />
                        {row.open_capa_count > 0 && (
                          <span
                            className={cn(
                              'font-medium tabular-nums',
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
                            {`${row.open_capa_count} CAPA open`}
                            {row.overdue_capa_count > 0 ? ' ⚠' : ''}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top tabular-nums text-muted-foreground">
                      {row.closed_on ? fmtDate(row.closed_on) : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
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
