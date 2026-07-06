// Environmental module (ISO 14001 operational core) — pure logic shared by the
// registers, project Environment tab, dashboard card and PDFs.
//
// THE SIGNIFICANCE MATHS AND THRESHOLD ARE DATABASE-ENFORCED: env_aspects.
// significance and env_aspects.significant are GENERATED columns in migration
// 0031_environmental.sql (likelihood × severity, significant when score >= 12).
// The constants below are the ONE TypeScript mirror (client-side preview);
// tests/env.test.ts parses the migration and asserts the two stay in agreement.
//
// Reconciliation rule (locked decision): a load records its own unit (m³ OR
// tonnes) and a permit states its allowance in its own unit. Usage sums ONLY
// loads recorded in the permit's unit — loads in the other unit are counted
// and surfaced, never silently converted (no defensible density assumption
// for mixed demolition/spoil streams).

// ─── Aspect significance (mirror of migration 0031 generated columns) ─────────

export const SIGNIFICANCE_THRESHOLD = 12

export function significanceScore(likelihood: number, severity: number): number {
  return likelihood * severity
}

export function isSignificant(score: number): boolean {
  return score >= SIGNIFICANCE_THRESHOLD
}

// ─── Permit reconciliation ────────────────────────────────────────────────────

/** WARN badge from this percentage used; red above 100%. */
export const PERMIT_WARN_PCT = 80

export type WasteUnit = 'm3' | 't'

export type PermitUsageLevel = 'ok' | 'warn' | 'over'

export interface PermitLoadLike {
  qty: number
  unit: WasteUnit
}

export interface PermitUsage {
  /** Sum of load qty recorded in the permit's own unit. */
  used: number
  /** used / allowance × 100 (2 dp); null when allowance is not positive. */
  pctUsed: number | null
  /** ok < 80% ≤ warn ≤ 100% < over. */
  level: PermitUsageLevel
  /** Loads against this permit recorded in the OTHER unit — surfaced, never converted. */
  otherUnitCount: number
}

/**
 * Reconciles the loads booked against a permit with its allowance.
 * `loads` must already be filtered to the permit in question.
 */
export function permitUsage(
  allowanceQty: number,
  allowanceUnit: WasteUnit,
  loads: PermitLoadLike[]
): PermitUsage {
  let used = 0
  let otherUnitCount = 0
  for (const load of loads) {
    if (load.unit === allowanceUnit) used += load.qty
    else otherUnitCount++
  }
  used = Math.round(used * 100) / 100

  const pctUsed =
    allowanceQty > 0 ? Math.round((used / allowanceQty) * 10000) / 100 : null

  const level: PermitUsageLevel =
    pctUsed === null
      ? 'ok'
      : pctUsed > 100
        ? 'over'
        : pctUsed >= PERMIT_WARN_PCT
          ? 'warn'
          : 'ok'

  return { used, pctUsed, level, otherUnitCount }
}

// ─── Gating warnings (WARN + override reason — never a hard block) ────────────

export interface GatingCheckInput {
  /** Facility picked for the load (null = none picked). */
  facility: { name: string; licence_expiry: string | null; active: boolean } | null
  /** Permit the load is booked against (null = none). */
  permit: {
    reference: string
    expiry: string | null
    classification: string
    allowance_qty: number
    allowance_unit: WasteUnit
  } | null
  /** Usage of that permit BEFORE this load. */
  permitLoadsSoFar: PermitLoadLike[]
  /** The load being recorded. */
  load: { classification: string; qty: number; unit: WasteUnit }
  /** AU calendar day ('YYYY-MM-DD'). */
  today: string
}

/**
 * Returns the list of gating warnings for a load. Non-empty means the UI must
 * WARN and require an override reason before saving (locked decision: warn +
 * override, never block — the truck is at the gate).
 */
export function gatingWarnings(input: GatingCheckInput): string[] {
  const warnings: string[] = []
  const { facility, permit, load, today } = input

  if (facility) {
    if (!facility.active) {
      warnings.push(`${facility.name} is marked inactive`)
    }
    if (facility.licence_expiry && facility.licence_expiry < today) {
      warnings.push(`${facility.name} licence expired ${facility.licence_expiry}`)
    }
  }

  if (permit) {
    if (permit.expiry && permit.expiry < today) {
      warnings.push(`Permit ${permit.reference} expired ${permit.expiry}`)
    }
    if (permit.classification !== load.classification) {
      warnings.push(
        `Permit ${permit.reference} covers a different waste classification`
      )
    }
    const before = permitUsage(
      permit.allowance_qty,
      permit.allowance_unit,
      input.permitLoadsSoFar
    )
    const afterUsed =
      before.used + (load.unit === permit.allowance_unit ? load.qty : 0)
    if (permit.allowance_qty > 0 && afterUsed > permit.allowance_qty) {
      warnings.push(
        `Permit ${permit.reference} allowance exceeded (${afterUsed} of ${permit.allowance_qty} ${permit.allowance_unit === 'm3' ? 'm³' : 't'})`
      )
    }
  }

  return warnings
}
