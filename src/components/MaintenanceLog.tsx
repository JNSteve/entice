import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import type { MaintenanceKind } from '@/lib/zod'

/**
 * Shared presentational pieces for the maintenance log — the kind badge and a
 * compact read-only list. Reused by the office site section (client component),
 * the job page and the project overview. This module is server-safe (no client
 * hooks) so both server pages and the 'use client' section can import it.
 */

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  make_safe: 'Make-safe',
  repair: 'Repair',
  maintenance: 'Maintenance',
  inspection: 'Inspection',
}

const KIND_CLASS: Record<MaintenanceKind, string> = {
  make_safe:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
  repair:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  maintenance:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
  inspection:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300',
}

export function MaintenanceKindBadge({ kind }: { kind: MaintenanceKind }) {
  return (
    <Badge variant="outline" className={cn('border font-medium', KIND_CLASS[kind])}>
      {MAINTENANCE_KIND_LABELS[kind] ?? kind}
    </Badge>
  )
}

/** Small amber "Open" pill — a temporary measure still needing a permanent fix. */
export function MaintenanceOpenChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Open
    </span>
  )
}

export interface MaintenanceLogListEntry {
  id: string
  kind: MaintenanceKind
  title: string
  done_at: string
  status: 'open' | 'resolved'
  clientId: string
  siteId: string
}

/**
 * Read-only timeline rows for the job/project cards. Each row links through to
 * the property page where the entry is managed. Renders nothing when empty —
 * callers gate the surrounding card on `entries.length`.
 */
export function MaintenanceLogList({ entries }: { entries: MaintenanceLogListEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {entries.map((e) => (
        <Link
          key={e.id}
          href={`/clients/${e.clientId}/sites/${e.siteId}`}
          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          <MaintenanceKindBadge kind={e.kind} />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {fmtDate(e.done_at)}
          </span>
          <span className="flex-1 truncate font-medium">{e.title}</span>
          {e.status === 'open' && <MaintenanceOpenChip />}
        </Link>
      ))}
    </div>
  )
}
