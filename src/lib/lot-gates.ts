// Pure close/conformance gates for the ITP / Lot conformance module
// (ISO 9001 8.5/8.6/8.7). These are the NON-BYPASSABLE rules the server
// actions enforce — extracted here so they are unit-testable without a
// database (mirrors src/lib/audit-gates.ts):
//
//   * a failed inspection or test is only RESOLVED by a linked NCR that is
//     itself CLOSED (NCR close already carries the mandatory
//     verification-of-effectiveness gate — reused, not rebuilt);
//   * a lot cannot close while a quality hold point is unreleased;
//   * a lot cannot close while any failure lacks a linked closed NCR;
//   * a lot cannot close while a record-required ITP item (not N/A) has no
//     passing inspection for the lot;
//   * conformance is derived, never hand-set — deriveLotConformance mirrors
//     the SQL fn lot_conformance() so the UI/tests agree with the database.

export type LotFailureCheck = {
  /** The linked NCR id, if any. */
  ncr_id: string | null
  /** The linked NCR's status ('open' … 'closed'), or null when no NCR. */
  ncr_status: string | null
}

/** A failure is dispositioned only when its NCR exists and is closed. */
export function failureResolved(f: LotFailureCheck): boolean {
  return f.ncr_id !== null && f.ncr_status === 'closed'
}

/** Counts inspection/test failures still lacking a linked CLOSED NCR. */
export function unresolvedFailureCount(failures: LotFailureCheck[]): number {
  return failures.filter((f) => !failureResolved(f)).length
}

export type LotGateCounts = {
  /** Quality hold points on the lot with status ≠ 'released'. */
  openHoldPointCount: number
  /** Failed inspections/tests without a linked closed NCR. */
  unresolvedFailureCount: number
  /** Record-required, non-N/A ITP items with no passing inspection for the lot. */
  missingRecordCount: number
}

/**
 * Mirror of the SQL fn lot_conformance() for non-closed lots:
 * unresolved failure → nonconforming; open hold point or missing record →
 * open; otherwise conforming.
 */
export function deriveLotConformance(
  counts: LotGateCounts
): 'nonconforming' | 'open' | 'conforming' {
  if (counts.unresolvedFailureCount > 0) return 'nonconforming'
  if (counts.openHoldPointCount > 0 || counts.missingRecordCount > 0) {
    return 'open'
  }
  return 'conforming'
}

/**
 * Gate for closing a lot. Returns an error string, or null when the close is
 * allowed. Order matters: failures first (the auditor-critical gate), then
 * hold points, then completeness.
 */
export function lotCloseError(counts: LotGateCounts): string | null {
  if (counts.unresolvedFailureCount > 0) {
    const n = counts.unresolvedFailureCount
    return `Cannot close — ${n} failed item${n === 1 ? '' : 's'} without a linked closed NCR (raise the NCR and drive it to verified close first)`
  }
  if (counts.openHoldPointCount > 0) {
    const n = counts.openHoldPointCount
    return `Cannot close — ${n} hold point${n === 1 ? '' : 's'} must be released first`
  }
  if (counts.missingRecordCount > 0) {
    const n = counts.missingRecordCount
    return `Cannot close — ${n} ITP item${n === 1 ? '' : 's'} still need a passing inspection record`
  }
  return null
}

export type HoldPointSourceItem = {
  id: string
  description: string
  point_type: string
  status: string
  responsible: string | null
}

/**
 * The ITP items that must carry a quality hold point when a lot is created:
 * every 'hold' point-type item that has not been struck out as N/A.
 */
export function holdPointItems(
  items: HoldPointSourceItem[]
): HoldPointSourceItem[] {
  return items.filter((i) => i.point_type === 'hold' && i.status !== 'na')
}
