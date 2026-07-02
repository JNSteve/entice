'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  DownloadIcon,
  ClipboardCheckIcon,
  CalendarPlusIcon,
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
import { Card, CardContent } from '@/components/ui/card'
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
  AUDIT_STANDARDS,
  AUDIT_STANDARD_LABELS,
  AUDIT_STATUSES,
  AUDIT_STATUS_LABELS,
  type AuditStandard,
  type AuditStatus,
  type AuditProgrammeStatus,
} from '@/lib/zod'
import { createAudit, createProgramme, setProgrammeStatus } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string
  number: string
  programme_id: string
  programme_year: string
  area_id: string
  area_name: string
  standards: AuditStandard[]
  auditor_name: string | null
  auditee: string | null
  planned_date: string | null
  conducted_date: string | null
  status: AuditStatus
  open_findings: number
  total_findings: number
  overdue: boolean
}

export interface ProgrammeRow {
  id: string
  year: string
  title: string
  status: AuditProgrammeStatus
  notes: string | null
}

export interface AreaOption {
  id: string
  name: string
}

export interface ProfileOption {
  id: string
  full_name: string
}

export interface TemplateOption {
  id: string
  name: string
}

// ─── Standards badges ─────────────────────────────────────────────────────────

export function StandardsBadges({ standards }: { standards: AuditStandard[] }) {
  if (standards.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {standards.map((s) => (
        <span
          key={s}
          className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        >
          {AUDIT_STANDARD_LABELS[s]}
        </span>
      ))}
    </div>
  )
}

// ─── New programme dialog ─────────────────────────────────────────────────────

function NewProgrammeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({ year: '', title: '', notes: '' })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createProgramme({
        year: form.year,
        title: form.title,
        notes: form.notes || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Programme created as draft')
      onOpenChange(false)
      setForm({ year: '', title: '', notes: '' })
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New audit programme</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Year</Label>
              <Input
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                placeholder="FY2027-28"
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="FY2027-28 Internal Audit Programme"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create programme'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Plan audit dialog ────────────────────────────────────────────────────────

function PlanAuditDialog({
  open,
  onOpenChange,
  programmes,
  areas,
  profiles,
  templates,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  programmes: ProgrammeRow[]
  areas: AreaOption[]
  profiles: ProfileOption[]
  templates: TemplateOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const openProgrammes = programmes.filter((p) => p.status !== 'closed')
  const defaultProgramme =
    openProgrammes.find((p) => p.status === 'active')?.id ??
    openProgrammes[0]?.id ??
    ''
  const [form, setForm] = useState({
    programme_id: defaultProgramme,
    area_id: '',
    auditor_id: '',
    auditee: '',
    planned_date: '',
    checklist_template_id: '',
  })
  const [standards, setStandards] = useState<AuditStandard[]>(['9001'])

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleStandard(s: AuditStandard) {
    setStandards((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createAudit({
        programme_id: form.programme_id,
        area_id: form.area_id,
        standards,
        auditor_id: form.auditor_id || null,
        auditee: form.auditee || null,
        planned_date: form.planned_date || null,
        checklist_template_id: form.checklist_template_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Audit planned')
      onOpenChange(false)
      if (result.id) router.push(`/whs/audits/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Plan audit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Programme</Label>
              <Select
                value={form.programme_id}
                onValueChange={(v) => v && field('programme_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a programme" />
                </SelectTrigger>
                <SelectContent>
                  {openProgrammes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Area / process</Label>
              <Select
                value={form.area_id}
                onValueChange={(v) => v && field('area_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick an area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Standards covered</Label>
            <div className="flex gap-2">
              {AUDIT_STANDARDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStandard(s)}
                  aria-pressed={standards.includes(s)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    standards.includes(s)
                      ? 'border-foreground bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {AUDIT_STANDARD_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Auditor</Label>
              <Select
                value={form.auditor_id}
                onValueChange={(v) =>
                  field('auditor_id', !v || v === '__none' ? '' : v)
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
              <Label>Planned date</Label>
              <Input
                type="date"
                value={form.planned_date}
                onChange={(e) => field('planned_date', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Auditee (person/function)</Label>
              <Input
                value={form.auditee}
                onChange={(e) => field('auditee', e.target.value)}
                placeholder="e.g. Estimating team"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Checklist</Label>
              <Select
                value={form.checklist_template_id}
                onValueChange={(v) =>
                  field('checklist_template_id', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick later" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Pick later</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !form.programme_id || !form.area_id || standards.length === 0}
            >
              {pending ? 'Planning…' : 'Plan audit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Programme header ─────────────────────────────────────────────────────────

function ProgrammeHeader({
  programme,
  audits,
  canManage,
  isAdmin,
}: {
  programme: ProgrammeRow
  audits: AuditRow[]
  canManage: boolean
  isAdmin: boolean
}) {
  const [pending, startTransition] = useTransition()
  const inProgramme = audits.filter((a) => a.programme_id === programme.id)
  const counts = Object.fromEntries(
    AUDIT_STATUSES.map((s) => [s, inProgramme.filter((a) => a.status === s).length])
  )

  function doTransition(status: string) {
    startTransition(async () => {
      const result = await setProgrammeStatus(programme.id, status)
      if (result.error) toast.error(result.error)
      else toast.success(`Programme ${status === 'active' ? 'activated' : status}`)
    })
  }

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{programme.title}</span>
            <StatusBadge status={programme.status} />
          </div>
          <span className="text-xs text-muted-foreground">
            {inProgramme.length} audit{inProgramme.length === 1 ? '' : 's'} ·{' '}
            {AUDIT_STATUSES.map((s) => `${counts[s]} ${AUDIT_STATUS_LABELS[s].toLowerCase()}`).join(' · ')}
          </span>
          {programme.notes && (
            <span className="text-xs text-muted-foreground">{programme.notes}</span>
          )}
        </div>
        {canManage && (
          <div className="flex gap-2">
            {programme.status === 'draft' && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => doTransition('active')}>
                Activate
              </Button>
            )}
            {programme.status === 'active' && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => doTransition('closed')}>
                Close programme
              </Button>
            )}
            {programme.status === 'closed' && isAdmin && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => doTransition('active')}>
                Reopen
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main register ────────────────────────────────────────────────────────────

export function AuditsRegister({
  audits,
  programmes,
  areas,
  profiles,
  templates,
  role,
}: {
  audits: AuditRow[]
  programmes: ProgrammeRow[]
  areas: AreaOption[]
  profiles: ProfileOption[]
  templates: TemplateOption[]
  role: string
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [standardFilter, setStandardFilter] = useState<string>('all')
  const [areaFilter, setAreaFilter] = useState<string>('all')
  const [planOpen, setPlanOpen] = useState(false)
  const [programmeOpen, setProgrammeOpen] = useState(false)

  const canManage = role === 'admin' || role === 'office'
  const isAdmin = role === 'admin'

  // The programme header shows the active programme (or the latest one).
  const headerProgramme =
    programmes.find((p) => p.status === 'active') ?? programmes[0] ?? null

  const filtered = audits.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (standardFilter !== 'all' && !row.standards.includes(standardFilter as AuditStandard))
      return false
    if (areaFilter !== 'all' && row.area_id !== areaFilter) return false
    return true
  })

  const tabCounts = Object.fromEntries(
    ['all', ...AUDIT_STATUSES].map((s) => [
      s,
      s === 'all' ? audits.length : audits.filter((r) => r.status === s).length,
    ])
  )

  function exportCsv() {
    downloadCsv(
      'audit-register.csv',
      filtered.map((r) => ({
        number: r.number,
        programme: r.programme_year,
        area: r.area_name,
        standards: r.standards.map((s) => AUDIT_STANDARD_LABELS[s]).join('; '),
        auditor: r.auditor_name ?? '',
        auditee: r.auditee ?? '',
        planned: r.planned_date ?? '',
        conducted: r.conducted_date ?? '',
        status: AUDIT_STATUS_LABELS[r.status],
        open_findings: r.open_findings,
        total_findings: r.total_findings,
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {headerProgramme && (
        <ProgrammeHeader
          programme={headerProgramme}
          audits={audits}
          canManage={canManage}
          isAdmin={isAdmin}
        />
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...AUDIT_STATUSES] as const).map((s) => (
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
              {s === 'all' ? 'All' : AUDIT_STATUS_LABELS[s]}{' '}
              <span className="text-xs opacity-70">{tabCounts[s]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Select value={standardFilter} onValueChange={(v) => setStandardFilter(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All standards" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All standards</SelectItem>
              {AUDIT_STANDARDS.map((s) => (
                <SelectItem key={s} value={s}>
                  {AUDIT_STANDARD_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={areaFilter} onValueChange={(v) => setAreaFilter(v ?? 'all')}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All areas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <DownloadIcon className="size-4" />
            CSV
          </Button>

          {canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setProgrammeOpen(true)}>
                <CalendarPlusIcon className="size-4" />
                New programme
              </Button>
              <Button size="sm" onClick={() => setPlanOpen(true)}>
                <PlusIcon className="size-4" />
                Plan audit
              </Button>
            </>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheckIcon className="size-8" />}
          title="No audits"
          description="No audits match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Area / process</TableHead>
                <TableHead>Standards</TableHead>
                <TableHead>Auditor</TableHead>
                <TableHead>Planned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Findings</TableHead>
                <TableHead>Programme</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/whs/audits/${row.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <Link
                      href={`/whs/audits/${row.id}`}
                      className="truncate text-sm hover:underline"
                    >
                      {row.area_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StandardsBadges standards={row.standards} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.auditor_name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'text-sm tabular-nums',
                        row.overdue
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'text-muted-foreground'
                      )}
                      title={row.overdue ? 'Past its planned date' : undefined}
                    >
                      {row.planned_date ? fmtDate(row.planned_date) : '—'}
                      {row.overdue ? ' ⚠' : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.total_findings > 0 ? (
                      <span
                        className={cn(
                          'text-xs font-medium tabular-nums',
                          row.open_findings > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {row.open_findings > 0
                          ? `${row.open_findings} open / ${row.total_findings}`
                          : `${row.total_findings} closed`}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.programme_year}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PlanAuditDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        programmes={programmes}
        areas={areas}
        profiles={profiles}
        templates={templates}
      />
      <NewProgrammeDialog open={programmeOpen} onOpenChange={setProgrammeOpen} />
    </div>
  )
}
