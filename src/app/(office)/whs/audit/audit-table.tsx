'use client'

import React, { useTransition } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { DownloadIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { downloadCsv } from '@/lib/csv'
import { summariseDetail } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'

// ─── Entity type config ───────────────────────────────────────────────────────

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  swms_instances: 'SWMS',
  swms_signatures: 'SWMS signature',
  hold_points: 'Hold point',
  form_templates: 'Form template',
  form_submissions: 'Form submission',
  form_signons: 'Form sign-on',
  incidents: 'Incident',
  corrective_actions: 'Corrective action',
  subbie_swms: 'Subbie SWMS',
  share_links: 'Share link',
}

// ─── Smart entity link ────────────────────────────────────────────────────────

function EntityLink({
  entityType,
  entityId,
  projectId,
}: {
  entityType: string
  entityId: string
  projectId: string | null
}) {
  const label = ENTITY_TYPE_LABELS[entityType] ?? entityType
  const short = entityId.slice(0, 8)

  if (entityType === 'incidents') {
    return (
      <Link
        href={`/whs/incidents/${entityId}`}
        className="hover:underline text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {label} <span className="text-muted-foreground font-mono text-xs">{short}</span>
      </Link>
    )
  }

  if (entityType === 'form_submissions') {
    return (
      <Link
        href={`/whs/forms?highlight=${entityId}`}
        className="hover:underline text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {label} <span className="text-muted-foreground font-mono text-xs">{short}</span>
      </Link>
    )
  }

  if (
    (entityType === 'swms_instances' ||
      entityType === 'swms_signatures' ||
      entityType === 'hold_points') &&
    projectId
  ) {
    return (
      <Link
        href={`/projects/${projectId}`}
        className="hover:underline text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {label} <span className="text-muted-foreground font-mono text-xs">{short}</span>
      </Link>
    )
  }

  return (
    <span className="text-sm">
      {label} <span className="text-muted-foreground font-mono text-xs">{short}</span>
    </span>
  )
}

// ─── Action badge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  if (action === 'insert')
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0 text-xs">
        insert
      </Badge>
    )
  if (action === 'update')
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-0 text-xs">
        update
      </Badge>
    )
  if (action === 'delete')
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0 text-xs">
        delete
      </Badge>
    )
  // external_signon, external_submission, etc.
  return (
    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0 text-xs">
      {action.replace('_', ' ')}
    </Badge>
  )
}

// ─── Actor cell ───────────────────────────────────────────────────────────────

function ActorCell({ actorName }: { actorName: string | null }) {
  if (!actorName) return <span className="text-muted-foreground text-sm">—</span>
  const isExt = actorName.startsWith('External —')
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className="truncate max-w-[140px]" title={actorName}>
        {actorName}
      </span>
      {isExt && (
        <Badge
          variant="outline"
          className="shrink-0 border-slate-200 bg-slate-50 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400"
        >
          External
        </Badge>
      )}
    </span>
  )
}

// ─── Detail cell ──────────────────────────────────────────────────────────────

function DetailCell({ row }: { row: AuditRow }) {
  const summary = summariseDetail(row)
  return (
    <span
      className="text-sm text-muted-foreground truncate block max-w-[260px]"
      title={summary}
    >
      {summary}
    </span>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  projects: { id: string; number: string; name: string }[]
  actors: string[]
  filters: AuditFilters
  onFilterChange: (key: string, value: string) => void
}

function FilterBar({ projects, actors, filters, onFilterChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={filters.from}
        onChange={(e) => onFilterChange('from', e.target.value)}
        className="w-36"
        placeholder="From"
        aria-label="Date from"
      />
      <Input
        type="date"
        value={filters.to}
        onChange={(e) => onFilterChange('to', e.target.value)}
        className="w-36"
        placeholder="To"
        aria-label="Date to"
      />

      <Select
        value={filters.project_id || '_all'}
        onValueChange={(v) => onFilterChange('project_id', !v || v === '_all' ? '' : v)}
      >
        <SelectTrigger className="w-52">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.number} — {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.entity_type || '_all'}
        onValueChange={(v) => onFilterChange('entity_type', !v || v === '_all' ? '' : v)}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All types</SelectItem>
          {Object.entries(ENTITY_TYPE_LABELS).map(([k, label]) => (
            <SelectItem key={k} value={k}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.actor || '_all'}
        onValueChange={(v) => onFilterChange('actor', !v || v === '_all' ? '' : v)}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All actors" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All actors</SelectItem>
          <SelectItem value="_external">External</SelectItem>
          {actors.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.action || '_all'}
        onValueChange={(v) => onFilterChange('action', !v || v === '_all' ? '' : v)}
      >
        <SelectTrigger className="w-36">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All actions</SelectItem>
          <SelectItem value="insert">Insert</SelectItem>
          <SelectItem value="update">Update</SelectItem>
          <SelectItem value="delete">Delete</SelectItem>
          <SelectItem value="external">External</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditFilters {
  from: string
  to: string
  project_id: string
  entity_type: string
  actor: string
  action: string
  page: number
}

interface AuditTableProps {
  rows: AuditRow[]
  total: number
  page: number
  pageSize: number
  projects: { id: string; number: string; name: string }[]
  actors: string[]
  filters: AuditFilters
  /** Rows for CSV export (all pages, up to 5000). */
  exportRows: AuditRow[]
  capped: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AuditTable({
  rows,
  total,
  page,
  pageSize,
  projects,
  actors,
  filters,
  exportRows,
  capped,
}: AuditTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function buildUrl(params: Record<string, string | number>) {
    const sp = new URLSearchParams()
    const merged: Record<string, string> = {
      from: filters.from,
      to: filters.to,
      project_id: filters.project_id,
      entity_type: filters.entity_type,
      actor: filters.actor,
      action: filters.action,
      page: String(filters.page),
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    }
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== '0') sp.set(k, v)
    }
    return `${pathname}?${sp.toString()}`
  }

  function handleFilterChange(key: string, value: string) {
    startTransition(() => {
      router.push(buildUrl({ [key]: value, page: 1 }))
    })
  }

  function handlePage(newPage: number) {
    startTransition(() => {
      router.push(buildUrl({ page: newPage }))
    })
  }

  function handleCsvExport() {
    const csvRows = exportRows.map((r) => ({
      at: format(parseISO(r.at), 'dd/MM/yyyy HH:mm:ss'),
      actor: r.actor_name ?? '',
      action: r.action,
      entity_type: ENTITY_TYPE_LABELS[r.entity_type] ?? r.entity_type,
      entity_id: r.entity_id,
      project_id: r.project_id ?? '',
      detail: JSON.stringify(r.detail),
    }))
    downloadCsv(
      `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`,
      csvRows
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar + export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar
          projects={projects}
          actors={actors}
          filters={filters}
          onFilterChange={handleFilterChange}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleCsvExport}
          disabled={exportRows.length === 0}
          title={capped ? 'Export capped at 5,000 rows' : undefined}
        >
          <DownloadIcon className="size-4" />
          CSV{capped ? ' (5k cap)' : ''}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Timestamp</TableHead>
              <TableHead className="w-44">Actor</TableHead>
              <TableHead className="w-28">Action</TableHead>
              <TableHead className="w-44">Entity</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No audit events match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                    {format(parseISO(row.at), 'dd/MM/yyyy HH:mm:ss')}
                  </TableCell>
                  <TableCell>
                    <ActorCell actorName={row.actor_name} />
                  </TableCell>
                  <TableCell>
                    <ActionBadge action={row.action} />
                  </TableCell>
                  <TableCell>
                    <EntityLink
                      entityType={row.entity_type}
                      entityId={row.entity_id}
                      projectId={row.project_id}
                    />
                  </TableCell>
                  <TableCell>
                    <DetailCell row={row} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total === 0
            ? 'No results'
            : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => handlePage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="mx-1 text-xs">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= totalPages}
            onClick={() => handlePage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
