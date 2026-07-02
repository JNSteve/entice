// Objectives & KPIs (ISO 6.2 / 9.1) — pure period + traffic-light logic.
// Client-safe: no Supabase imports. The server-side metric computations live
// in src/lib/kpi-metrics.ts; everything here is deterministic and unit-tested
// (tests/objectives.test.ts).
//
// Period keys are Brisbane-calendar: 'YYYY-MM' for monthly objectives,
// 'YYYY-Qn' (calendar quarters) for quarterly. All 'today' inputs are
// 'YYYY-MM-DD' AU date strings — server code passes todayAU() (src/lib/tz.ts).

import type { ObjectiveDirection, ObjectivePeriod } from '@/lib/zod'

// ─── Auto metric registry keys (labels are client-safe; compute fns are not) ──

export const AUTO_METRIC_KEYS = [
  'ltifr',
  'incident_count',
  'environmental_incident_count',
  'ncr_count',
  'capa_on_time_close_pct',
  'on_time_delivery_pct',
  'training_compliance_pct',
  'audit_on_time_close_pct',
] as const
export type AutoMetricKey = (typeof AUTO_METRIC_KEYS)[number]

export const AUTO_METRIC_LABELS: Record<AutoMetricKey, string> = {
  ltifr: 'LTIFR (lost-time injuries per 1M hours)',
  incident_count: 'Incidents occurred',
  environmental_incident_count: 'Environmental incidents',
  ncr_count: 'NCRs raised',
  capa_on_time_close_pct: 'CAPA actions closed on time (%)',
  on_time_delivery_pct: 'Projects delivered on programme (%)',
  training_compliance_pct: 'Training compliance (%)',
  audit_on_time_close_pct: 'Audits closed on time (%)',
}

// ─── Period keys ──────────────────────────────────────────────────────────────

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const QUARTER_KEY_RE = /^\d{4}-Q[1-4]$/

export function isMonthKey(key: string): boolean {
  return MONTH_KEY_RE.test(key)
}

export function isQuarterKey(key: string): boolean {
  return QUARTER_KEY_RE.test(key)
}

/** Period key containing the given AU date ('YYYY-MM-DD'). */
export function periodKeyFor(period: ObjectivePeriod, dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  if (period === 'monthly') return `${y}-${String(m).padStart(2, '0')}`
  return `${y}-Q${Math.ceil(m / 3)}`
}

/** The calendar months ('YYYY-MM') making up a period key. */
export function monthsOf(periodKey: string): string[] {
  if (isMonthKey(periodKey)) return [periodKey]
  if (isQuarterKey(periodKey)) {
    const year = Number(periodKey.slice(0, 4))
    const q = Number(periodKey.slice(6))
    const first = (q - 1) * 3 + 1
    return [first, first + 1, first + 2].map(
      (m) => `${year}-${String(m).padStart(2, '0')}`
    )
  }
  throw new Error(`Invalid period key: ${periodKey}`)
}

/**
 * Half-open date range of a period key: start (inclusive) and end (exclusive),
 * both 'YYYY-MM-DD'. Pure calendar arithmetic — no host-clock involvement.
 */
export function periodRangeOf(periodKey: string): {
  start: string
  endExclusive: string
} {
  const months = monthsOf(periodKey)
  const start = `${months[0]}-01`
  const [ly, lm] = months[months.length - 1].split('-').map(Number)
  const ny = lm === 12 ? ly + 1 : ly
  const nm = lm === 12 ? 1 : lm + 1
  return { start, endExclusive: `${ny}-${String(nm).padStart(2, '0')}-01` }
}

/** True when the period has fully elapsed as at the AU `today`. */
export function isElapsed(periodKey: string, today: string): boolean {
  return periodRangeOf(periodKey).endExclusive <= today
}

/** True when the AU `today` falls inside the period. */
export function isCurrent(periodKey: string, today: string): boolean {
  const { start, endExclusive } = periodRangeOf(periodKey)
  return start <= today && today < endExclusive
}

/**
 * Every period key from the one containing `anchorDate` through the one
 * containing `today`, ascending. Returns [] when the anchor is in the future.
 */
export function enumeratePeriods(
  period: ObjectivePeriod,
  anchorDate: string,
  today: string
): string[] {
  if (anchorDate > today) return []
  const keys: string[] = []
  const last = periodKeyFor(period, today)
  let key = periodKeyFor(period, anchorDate)
  // Hard cap keeps a bad anchor from looping forever (~30 years of periods).
  for (let i = 0; i < 400; i++) {
    keys.push(key)
    if (key === last) break
    key = nextPeriodKey(key)
  }
  return keys
}

export function nextPeriodKey(periodKey: string): string {
  if (isMonthKey(periodKey)) {
    const [y, m] = periodKey.split('-').map(Number)
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    return `${ny}-${String(nm).padStart(2, '0')}`
  }
  if (isQuarterKey(periodKey)) {
    const y = Number(periodKey.slice(0, 4))
    const q = Number(periodKey.slice(6))
    return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`
  }
  throw new Error(`Invalid period key: ${periodKey}`)
}

/** Human label: '2026-07' → 'Jul 2026'; '2026-Q3' → 'Q3 2026'. */
export function periodKeyLabel(periodKey: string): string {
  if (isQuarterKey(periodKey)) {
    return `${periodKey.slice(5)} ${periodKey.slice(0, 4)}`
  }
  if (isMonthKey(periodKey)) {
    const MONTHS = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]
    const [y, m] = periodKey.split('-').map(Number)
    return `${MONTHS[m - 1]} ${y}`
  }
  return periodKey
}

// ─── Direction-aware traffic light ────────────────────────────────────────────

export type ObjectiveTrafficStatus =
  | 'on_track'
  | 'at_risk'
  | 'off_track'
  | 'no_data'

export const OBJECTIVE_TRAFFIC_LABELS: Record<ObjectiveTrafficStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  no_data: 'No data',
}

/** Amber band: within 10% of the target on the wrong side. */
const AT_RISK_TOLERANCE = 0.1

/**
 * Direction-aware status of a KPI value against its target:
 *  - at_most (lower is better — LTIFR, incident/NCR counts): value ≤ target is
 *    on_track; up to target × 1.1 is at_risk; beyond is off_track. A target of
 *    0 has no amber band — any breach is off_track.
 *  - at_least (higher is better — % / score targets): value ≥ target is
 *    on_track; down to target × 0.9 is at_risk; below is off_track.
 * A null value (no data for the period) is no_data, never a false green.
 */
export function deriveObjectiveStatus(
  direction: ObjectiveDirection,
  target: number,
  value: number | null | undefined
): ObjectiveTrafficStatus {
  if (value == null || Number.isNaN(value)) return 'no_data'
  if (direction === 'at_most') {
    if (value <= target) return 'on_track'
    if (value <= target * (1 + AT_RISK_TOLERANCE)) return 'at_risk'
    return 'off_track'
  }
  if (value >= target) return 'on_track'
  if (value >= target * (1 - AT_RISK_TOLERANCE)) return 'at_risk'
  return 'off_track'
}

// ─── LTIFR arithmetic ─────────────────────────────────────────────────────────

/**
 * LTIFR = (lost-time injuries × 1,000,000) / hours worked, rounded to 2 dp.
 * No hours recorded (null/0) → null — an unmeasured period is never a fake 0.
 */
export function ltifr(
  lostTimeInjuries: number,
  hoursWorked: number | null
): number | null {
  if (hoursWorked == null || hoursWorked <= 0) return null
  return Math.round(((lostTimeInjuries * 1_000_000) / hoursWorked) * 100) / 100
}

/** % helper rounded to 1 dp; null when the denominator is 0 (nothing to rate). */
export function pctOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

// ─── On-time programme delivery (owner decision: programme baseline) ─────────

export interface DeliveryTaskLike {
  project_id: string
  end_date: string // current/actual task end (the Gantt live date)
  progress_pct: number
  baseline_end: string | null
}

/**
 * % of projects whose programme FINISHED in [start, endExclusive) that
 * finished on/before their baseline end. A project counts as finished when it
 * has tasks, every task is 100% complete, and its actual finish — the latest
 * task end_date — falls in the window. Projects without any baseline_end are
 * excluded (nothing to measure against). Returns null when no project
 * finished in the window.
 */
export function onTimeDeliveryPct(
  tasks: DeliveryTaskLike[],
  start: string,
  endExclusive: string
): number | null {
  const byProject = new Map<string, DeliveryTaskLike[]>()
  for (const t of tasks) {
    const list = byProject.get(t.project_id)
    if (list) list.push(t)
    else byProject.set(t.project_id, [t])
  }

  let finished = 0
  let onTime = 0
  for (const list of byProject.values()) {
    if (list.length === 0) continue
    if (!list.every((t) => Number(t.progress_pct) >= 100)) continue
    const baselineEnds = list
      .map((t) => t.baseline_end)
      .filter((d): d is string => d != null)
    if (baselineEnds.length === 0) continue
    const actualFinish = list.reduce(
      (max, t) => (t.end_date > max ? t.end_date : max),
      list[0].end_date
    )
    if (actualFinish < start || actualFinish >= endExclusive) continue
    const baselineFinish = baselineEnds.reduce((max, d) => (d > max ? d : max))
    finished++
    if (actualFinish <= baselineFinish) onTime++
  }

  return pctOf(onTime, finished)
}
