// Training & competency derived status (ISO 7.2). Pure functions — the expiry
// status is DERIVED at read time (no cron, no stored status column). Callers
// inject `today` as the AU (Brisbane) calendar day: server code passes
// todayAU() (src/lib/tz.ts), client code todayAUClient() (src/lib/tz-client.ts).
// The 30-day amber threshold is the same rule as vendor compliance
// (src/lib/compliance.ts).

import { addDaysISO } from '@/lib/compliance'

// ─── Status of a single record ───────────────────────────────────────────────

export type CompetencyStatus = 'current' | 'expiring' | 'expired'
/** Matrix cell: a required competency with no record at all is 'missing'. */
export type MatrixCellStatus = CompetencyStatus | 'missing'

export const COMPETENCY_STATUS_LABELS: Record<MatrixCellStatus, string> = {
  current: 'Current',
  expiring: 'Expiring ≤30 days',
  expired: 'Expired',
  missing: 'Missing',
}

/**
 * Derives the traffic-light status for one record's expiry date.
 * - null expiry (non-expiring ticket, e.g. White Card) → 'current'
 * - before today → 'expired'
 * - today .. today+30 inclusive → 'expiring'
 * - later → 'current'
 * Boundary semantics match deriveComplianceStatus: a record expiring TODAY is
 * still (just) valid — 'expiring', not 'expired'.
 */
export function deriveCompetencyStatus(
  expiryDate: string | null,
  today: string
): CompetencyStatus {
  if (!expiryDate) return 'current'
  if (expiryDate < today) return 'expired'
  if (expiryDate <= addDaysISO(today, 30)) return 'expiring'
  return 'current'
}

// ─── De-dup rule ─────────────────────────────────────────────────────────────

export interface CompetencyRecordLike {
  id: string
  worker_id: string
  competency_type_id: string
  issue_date: string
  expiry_date: string | null
  superseded_by: string | null
  created_at?: string
}

/** Map key for a (worker, competency type) pair. */
export function workerTypeKey(workerId: string, typeId: string): string {
  return `${workerId}::${typeId}`
}

/**
 * The de-dup rule: the LATEST NON-SUPERSEDED record per (worker, type) drives
 * the status light. Superseded rows are ignored entirely; among the rest the
 * newest issue_date wins (created_at, then id, as tie-breaks so the result is
 * deterministic).
 */
export function latestRecords<T extends CompetencyRecordLike>(
  records: T[]
): Map<string, T> {
  const latest = new Map<string, T>()
  for (const r of records) {
    if (r.superseded_by !== null) continue
    const key = workerTypeKey(r.worker_id, r.competency_type_id)
    const prev = latest.get(key)
    if (!prev || isNewer(r, prev)) latest.set(key, r)
  }
  return latest
}

function isNewer(a: CompetencyRecordLike, b: CompetencyRecordLike): boolean {
  if (a.issue_date !== b.issue_date) return a.issue_date > b.issue_date
  const ac = a.created_at ?? ''
  const bc = b.created_at ?? ''
  if (ac !== bc) return ac > bc
  return a.id > b.id
}

// ─── Expiry defaulting ───────────────────────────────────────────────────────

/**
 * Default expiry for a record: issue date + the type's validity_months
 * (calendar-month arithmetic on the date string; clamps 31st→30th/28th etc.).
 * Returns null when the type never expires.
 */
export function defaultExpiry(
  issueDate: string,
  validityMonths: number | null
): string | null {
  if (!validityMonths) return null
  const [y, m, d] = issueDate.split('-').map(Number)
  const total = (m - 1) + validityMonths
  const year = y + Math.floor(total / 12)
  const month = (total % 12) + 1
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(d, daysInMonth)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
