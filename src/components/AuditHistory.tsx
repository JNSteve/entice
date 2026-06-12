/**
 * AuditHistory — compact server-compatible history list.
 *
 * Pass `rows` from `fetchAuditFor()`.  Renders as a collapsible card shell
 * with a compact list of timestamped events.  Can be used in server and client
 * components alike (no client-side data fetching here).
 */
import React from 'react'
import { format, parseISO } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import type { AuditRow } from '@/lib/audit-queries'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isExternal(row: AuditRow): boolean {
  return (
    row.action.startsWith('external_') ||
    (row.actor_name != null && row.actor_name.startsWith('External —'))
  )
}

/** Produce a one-line human summary of the audit row detail. */
export function summariseDetail(row: AuditRow): string {
  const { detail, action } = row

  // Changed fields from UPDATE triggers
  const changed = detail?.changed as Record<string, { from: unknown; to: unknown }> | undefined
  if (changed) {
    const entries = Object.entries(changed)
    if (entries.length === 0) return action

    const parts = entries.slice(0, 2).map(([col, { from, to }]) => {
      const fromStr = from == null ? '—' : String(from)
      const toStr = to == null ? '—' : String(to)
      // Long text — signal content change only
      if (fromStr.length > 60 || toStr.length > 60) {
        return `${col}: content revised`
      }
      return `${col}: ${fromStr} → ${toStr}`
    })
    const extra = entries.length > 2 ? ` +${entries.length - 2} more` : ''
    return parts.join(', ') + extra
  }

  // Summary field (external submissions / sign-ons etc.)
  const summary = detail?.summary as string | undefined
  if (summary) return summary

  // Label (share-link events)
  const label = detail?.label as string | undefined
  if (label) return label

  // Title
  const title = detail?.title as string | undefined
  if (title) return `title: ${title}`

  return action
}

function actionBadge(action: string) {
  if (action === 'insert')
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0 text-[10px] font-medium px-1.5 py-0">
        created
      </Badge>
    )
  if (action === 'update')
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-0 text-[10px] font-medium px-1.5 py-0">
        updated
      </Badge>
    )
  if (action === 'delete')
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0 text-[10px] font-medium px-1.5 py-0">
        deleted
      </Badge>
    )
  if (action.startsWith('external_'))
    return (
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0 text-[10px] font-medium px-1.5 py-0">
        {action.replace('external_', 'ext ')}
      </Badge>
    )
  return (
    <Badge variant="secondary" className="text-[10px] font-medium px-1.5 py-0">
      {action}
    </Badge>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AuditHistoryProps {
  rows: AuditRow[]
  /** Optional override heading text (default "History"). */
  heading?: string
}

/**
 * Renders a compact list of audit rows. Designed to be embedded inside a Card
 * or similar container — the caller is responsible for the Card wrapper so the
 * component can be reused in different layout contexts.
 */
export function AuditHistory({ rows, heading = 'History' }: AuditHistoryProps) {
  if (rows.length === 0) {
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
        </p>
        <p className="text-sm text-muted-foreground">No history yet.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </p>
      <ol className="flex flex-col divide-y">
        {rows.map((row) => {
          const ext = isExternal(row)
          const summary = summariseDetail(row)
          return (
            <li key={row.id} className="flex items-start gap-3 py-2 text-sm">
              {/* Timestamp */}
              <span className="w-32 shrink-0 tabular-nums text-xs text-muted-foreground">
                {format(parseISO(row.at), 'dd/MM/yy HH:mm')}
              </span>

              {/* Action badge */}
              <span className="mt-px shrink-0">{actionBadge(row.action)}</span>

              {/* Actor */}
              <span className="min-w-0 shrink-0 max-w-[120px] truncate text-xs">
                {row.actor_name ?? '—'}
                {ext && (
                  <Badge
                    variant="outline"
                    className="ml-1 text-[9px] px-1 py-0 border-slate-300 text-slate-500"
                  >
                    ext
                  </Badge>
                )}
              </span>

              {/* Summary */}
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={summary}>
                {summary}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
