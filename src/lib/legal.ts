// Legal & Compliance Obligations Register (ISO 6.1.3 / 9.1.2) — pure logic.
// Client-safe: no Supabase imports. Deterministic and unit-tested
// (tests/legal.test.ts).
//
// AUTHORITY NOTE: legal_obligations.current_compliance is DERIVED in the
// database — an AFTER INSERT/DELETE trigger on compliance_evaluations
// recomputes it from the latest evaluation, and a BEFORE INSERT/UPDATE guard
// on legal_obligations rejects any other write to that column. The helpers
// here MIRROR that DB logic for display/derivation on already-fetched rows;
// they are never used to persist the column.

export interface EvaluationLike {
  evaluated_on: string // 'YYYY-MM-DD'
  created_at: string // ISO timestamp — tiebreaker for same-day re-evaluations
}

/**
 * The evaluation that decides current compliance: latest evaluated_on, ties
 * broken by created_at (a same-day re-evaluation supersedes the earlier one).
 * Mirrors the DB recompute `order by evaluated_on desc, created_at desc`.
 */
export function latestEvaluation<T extends EvaluationLike>(
  evaluations: T[]
): T | null {
  let latest: T | null = null
  for (const e of evaluations) {
    if (
      latest === null ||
      e.evaluated_on > latest.evaluated_on ||
      (e.evaluated_on === latest.evaluated_on && e.created_at > latest.created_at)
    ) {
      latest = e
    }
  }
  return latest
}

/**
 * Next review date after an evaluation: evaluated_on + review_frequency_months,
 * with Postgres `date + make_interval(months => n)` semantics — the day of
 * month is kept, clamped to the last day of the target month
 * (2026-01-31 + 1 month = 2026-02-28; 2024-01-31 + 1 month = 2024-02-29).
 * Pure calendar arithmetic — no host-clock involvement.
 */
export function nextReviewFrom(
  evaluatedOn: string,
  frequencyMonths: number
): string {
  const [y, m, d] = evaluatedOn.split('-').map(Number)
  const totalMonths = m - 1 + frequencyMonths
  const targetYear = y + Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12 // 0-based
  // Day 0 of month+1 = last day of the target month (UTC — no TZ edge cases).
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
