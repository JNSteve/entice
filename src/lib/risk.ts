// Risk & Opportunity register (ISO 6.1) — pure rating + close-gate logic.
//
// THE 5×5 MATRIX BANDS ARE FIXED AND DATABASE-ENFORCED. The single source of
// truth is the IMMUTABLE SQL function risk_rating(score) in
// supabase/migrations/0022_risk_register.sql, which feeds the GENERATED
// inherent_rating/residual_rating columns — so historic ratings can never
// silently change. RISK_BANDS below is the one TypeScript mirror of those
// bands (used for client-side preview and the heat map); tests/risk.test.ts
// parses the migration and asserts the two definitions agree. Never add a
// second copy of the bands anywhere else.

import type { RiskKind, RiskStatus } from '@/lib/zod'

export type RiskRating = 'Low' | 'Medium' | 'High' | 'Extreme'

/** Mirror of risk_rating() in migration 0022 — see header before editing. */
export const RISK_BANDS: { min: number; max: number; rating: RiskRating }[] = [
  { min: 1, max: 4, rating: 'Low' },
  { min: 5, max: 9, rating: 'Medium' },
  { min: 10, max: 16, rating: 'High' },
  { min: 17, max: 25, rating: 'Extreme' },
]

/** TS mirror of the SQL risk_rating(score) fn. null in → null out (STRICT). */
export function riskRating(score: number | null | undefined): RiskRating | null {
  if (score == null) return null
  const band = RISK_BANDS.find((b) => score >= b.min && score <= b.max)
  return band?.rating ?? null
}

/** Standard 5-point descriptors for the fixed matrix axes. For opportunities
 *  read consequence as benefit magnitude. */
export const LIKELIHOOD_LABELS: Record<number, string> = {
  1: 'Rare',
  2: 'Unlikely',
  3: 'Possible',
  4: 'Likely',
  5: 'Almost certain',
}

export const CONSEQUENCE_LABELS: Record<number, string> = {
  1: 'Insignificant',
  2: 'Minor',
  3: 'Moderate',
  4: 'Major',
  5: 'Catastrophic',
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Permitted status moves. The working statuses (open/treating/accepted) are
 * freely navigable; 'closed' is gated by riskCloseError below; closed → open
 * is the admin-only reopen (enforced in the action alongside this table).
 */
export const RISK_TRANSITIONS: Record<RiskStatus, RiskStatus[]> = {
  open: ['treating', 'accepted', 'closed'],
  treating: ['open', 'accepted', 'closed'],
  accepted: ['open', 'treating', 'closed'],
  closed: ['open'], // admin reopen
}

export function riskTransitionAllowed(from: RiskStatus, to: RiskStatus): boolean {
  return (RISK_TRANSITIONS[from] ?? []).includes(to)
}

// ─── Close gate (NON-BYPASSABLE — enforced in the server action) ─────────────

export type RiskCloseCheck = {
  kind: RiskKind
  residual_likelihood: number | null
  residual_consequence: number | null
}

/**
 * Gate for moving a risk item to 'closed':
 *   * NO item (risk or opportunity) may close while it has open treatments;
 *   * a RISK additionally requires residual likelihood AND consequence
 *     recorded — the evidence the treatment worked. Opportunities are exempt
 *     from residual scoring.
 * Returns an error string, or null when the close is allowed.
 */
export function riskCloseError(
  item: RiskCloseCheck,
  openTreatmentCount: number
): string | null {
  if (openTreatmentCount > 0) {
    return `Cannot close — ${openTreatmentCount} open treatment${
      openTreatmentCount === 1 ? '' : 's'
    } must be completed first`
  }
  if (
    item.kind === 'risk' &&
    (item.residual_likelihood == null || item.residual_consequence == null)
  ) {
    return 'Cannot close a risk without a residual likelihood and consequence recorded — score the residual risk to evidence the treatments worked'
  }
  return null
}
