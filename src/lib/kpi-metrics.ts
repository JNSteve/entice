// Objectives & KPIs (ISO 6.2 / 9.1) — the single server-side metrics engine.
// Every AUTO objective's actuals are derived here, period-by-period, from the
// live registers this module CONSUMES (it never owns them): incidents, NCRs /
// CAPA actions, internal audits, competency records, programme baselines and
// the manual company_hours feed.
//
// Contract: compute(supabase, periodKey) returns the metric value for the
// period, or NULL when the period is unmeasurable (no hours entered, empty
// denominator, no finished projects). Null means "no data" — it is never
// written to kpi_values and never rendered as a fake 0.
//
// Mappings (documented decisions):
//   * Lost-time injury (LTIFR numerator) = incidents with type 'injury' AND
//     severity ≥ 3 on the register's 1(low)–5(critical) scale. The incidents
//     schema has no explicit lost-time flag; severity 1–2 are first-aid /
//     medical-treatment level, 3+ is taken as a shift lost.
//   * On-time delivery (owner decision: programme baseline) — a project's
//     programme is finished when all its tasks are 100% complete; actual
//     finish = latest task end_date, baseline finish = latest baseline_end.
//     Projects without a baseline are excluded.
//   * Audit on-time close = closed within 30 days of planned_date; audits
//     without a planned date are excluded.
//   * Training compliance is a CURRENT-STATE snapshot of the register — it is
//     only computed for the period containing today (history accrues as each
//     period is refreshed live; past states cannot be reconstructed).
//   * Timestamps are bucketed by their Brisbane calendar day (fixed +10:00).

import type { SupabaseClient } from '@supabase/supabase-js'
import { todayAU } from '@/lib/tz'
import {
  closedWithinDaysPct,
  ltifr,
  monthsOf,
  onTimeDeliveryPct,
  pctOf,
  periodKeyFor,
  periodRangeOf,
  enumeratePeriods,
  isCurrent,
  type AutoMetricKey,
  type DeliveryTaskLike,
} from '@/lib/objectives'
import { AUTO_METRIC_LABELS } from '@/lib/objectives'
import {
  deriveCompetencyStatus,
  latestRecords,
  workerTypeKey,
  type CompetencyRecordLike,
} from '@/lib/competency'
import type { ObjectivePeriod } from '@/lib/zod'

type Supabase = SupabaseClient

/** UTC instant of Brisbane midnight for an AU date — timestamptz filters. */
function auMidnightInstant(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+10:00`).toISOString()
}

/** [startInstant, endInstant) for a period key's Brisbane calendar range. */
function periodInstants(periodKey: string): { start: string; end: string } {
  const { start, endExclusive } = periodRangeOf(periodKey)
  return { start: auMidnightInstant(start), end: auMidnightInstant(endExclusive) }
}

/** Brisbane calendar day ('YYYY-MM-DD') of a stored timestamptz. */
function auDateOf(instant: string): string {
  return todayAU(new Date(instant))
}

async function countIncidents(
  supabase: Supabase,
  periodKey: string,
  filters: { type?: string; minSeverity?: number }
): Promise<number> {
  const { start, end } = periodInstants(periodKey)
  let query = supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .gte('occurred_at', start)
    .lt('occurred_at', end)
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.minSeverity) query = query.gte('severity', filters.minSeverity)
  const { count, error } = await query
  if (error) throw new Error(`incidents query failed: ${error.message}`)
  return count ?? 0
}

// ─── The registry ─────────────────────────────────────────────────────────────

export type AutoMetric = {
  label: string
  compute: (supabase: Supabase, periodKey: string) => Promise<number | null>
}

export const AUTO_METRICS: Record<AutoMetricKey, AutoMetric> = {
  // (lost-time injuries × 1,000,000) / manually-entered company hours.
  // Quarters sum the hours of their entered months; a period with NO hours
  // entered is unmeasured → null (never 0).
  ltifr: {
    label: AUTO_METRIC_LABELS.ltifr,
    compute: async (supabase, periodKey) => {
      const months = monthsOf(periodKey)
      const { data: hourRows, error } = await supabase
        .from('company_hours')
        .select('period_key, hours')
        .in('period_key', months)
      if (error) throw new Error(`company_hours query failed: ${error.message}`)
      if (!hourRows || hourRows.length === 0) return null
      const hours = hourRows.reduce((s, r) => s + Number(r.hours), 0)
      const lostTime = await countIncidents(supabase, periodKey, {
        type: 'injury',
        minSeverity: 3,
      })
      return ltifr(lostTime, hours)
    },
  },

  incident_count: {
    label: AUTO_METRIC_LABELS.incident_count,
    compute: (supabase, periodKey) => countIncidents(supabase, periodKey, {}),
  },

  environmental_incident_count: {
    label: AUTO_METRIC_LABELS.environmental_incident_count,
    compute: (supabase, periodKey) =>
      countIncidents(supabase, periodKey, { type: 'environmental' }),
  },

  ncr_count: {
    label: AUTO_METRIC_LABELS.ncr_count,
    compute: async (supabase, periodKey) => {
      const { start, end } = periodInstants(periodKey)
      const { count, error } = await supabase
        .from('ncrs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', start)
        .lt('created_at', end)
      if (error) throw new Error(`ncrs query failed: ${error.message}`)
      return count ?? 0
    },
  },

  // % of CAPA actions COMPLETED in the period that completed on/before their
  // due date (AU calendar-day comparison). Actions without a due date are
  // excluded; no completions with due dates in the period → null.
  capa_on_time_close_pct: {
    label: AUTO_METRIC_LABELS.capa_on_time_close_pct,
    compute: async (supabase, periodKey) => {
      const { start, end } = periodInstants(periodKey)
      const { data, error } = await supabase
        .from('capa_actions')
        .select('due_date, completed_at')
        .gte('completed_at', start)
        .lt('completed_at', end)
        .not('due_date', 'is', null)
      if (error) throw new Error(`capa_actions query failed: ${error.message}`)
      const rows = data ?? []
      const onTime = rows.filter(
        (r) => auDateOf(r.completed_at as string) <= (r.due_date as string)
      ).length
      return pctOf(onTime, rows.length)
    },
  },

  // % of CAPA actions COMPLETED in the period that closed within 28 calendar
  // days of being raised (AU calendar-day comparison, inclusive). SMS-M-01
  // WHS Manual §6.3: "all corrective actions closed within 28 days of being
  // raised". No completions in the period → null.
  capa_closed_28d_pct: {
    label: AUTO_METRIC_LABELS.capa_closed_28d_pct,
    compute: async (supabase, periodKey) => {
      const { start, end } = periodInstants(periodKey)
      const { data, error } = await supabase
        .from('capa_actions')
        .select('created_at, completed_at')
        .gte('completed_at', start)
        .lt('completed_at', end)
      if (error) throw new Error(`capa_actions query failed: ${error.message}`)
      return closedWithinDaysPct(
        (data ?? []).map((r) => ({
          createdDate: auDateOf(r.created_at as string),
          completedDate: auDateOf(r.completed_at as string),
        })),
        28
      )
    },
  },

  // Owner decision: programme baseline vs actual (see module header).
  on_time_delivery_pct: {
    label: AUTO_METRIC_LABELS.on_time_delivery_pct,
    compute: async (supabase, periodKey) => {
      const { start, endExclusive } = periodRangeOf(periodKey)
      const { data, error } = await supabase
        .from('programme_tasks')
        .select('project_id, end_date, progress_pct, baseline_end')
      if (error) {
        throw new Error(`programme_tasks query failed: ${error.message}`)
      }
      return onTimeDeliveryPct(
        (data ?? []) as DeliveryTaskLike[],
        start,
        endExclusive
      )
    },
  },

  // Current-state snapshot (see module header): % of (active worker ×
  // mandatory role requirement) pairs whose latest non-superseded record is
  // not expired. Only computed for the period containing today.
  training_compliance_pct: {
    label: AUTO_METRIC_LABELS.training_compliance_pct,
    compute: async (supabase, periodKey) => {
      const today = todayAU()
      if (!isCurrent(periodKey, today)) return null

      const [{ data: workers }, { data: reqs }, { data: records }] =
        await Promise.all([
          supabase.from('workers').select('id, role').eq('active', true),
          supabase
            .from('role_competency_requirements')
            .select('role, competency_type_id, competency_types(active)')
            .eq('is_mandatory', true),
          supabase
            .from('competency_records')
            .select(
              'id, worker_id, competency_type_id, issue_date, expiry_date, superseded_by, created_at'
            )
            .is('superseded_by', null),
        ])

      const activeReqs = ((reqs ?? []) as unknown as {
        role: string
        competency_type_id: string
        competency_types: { active: boolean } | null
      }[]).filter((r) => r.competency_types?.active !== false)

      const latest = latestRecords((records ?? []) as CompetencyRecordLike[])

      let pairs = 0
      let compliant = 0
      for (const w of workers ?? []) {
        for (const req of activeReqs) {
          if (req.role !== (w.role as string)) continue
          pairs++
          const rec = latest.get(
            workerTypeKey(w.id as string, req.competency_type_id)
          )
          if (!rec) continue
          if (deriveCompetencyStatus(rec.expiry_date, today) !== 'expired') {
            compliant++
          }
        }
      }
      return pctOf(compliant, pairs)
    },
  },

  // % of internal audits CLOSED in the period that closed within 30 days of
  // their planned date. Audits without a planned date are excluded; no
  // closures in the period → null.
  audit_on_time_close_pct: {
    label: AUTO_METRIC_LABELS.audit_on_time_close_pct,
    compute: async (supabase, periodKey) => {
      const { start, end } = periodInstants(periodKey)
      const { data, error } = await supabase
        .from('audits')
        .select('planned_date, closed_at')
        .gte('closed_at', start)
        .lt('closed_at', end)
        .not('planned_date', 'is', null)
      if (error) throw new Error(`audits query failed: ${error.message}`)
      const rows = data ?? []
      const onTime = rows.filter((r) => {
        const planned = new Date(`${r.planned_date as string}T00:00:00+10:00`)
        planned.setUTCDate(planned.getUTCDate() + 30)
        const deadline = todayAU(planned)
        return auDateOf(r.closed_at as string) <= deadline
      }).length
      return pctOf(onTime, rows.length)
    },
  },
}

// ─── Refresh engine ───────────────────────────────────────────────────────────

export type RefreshedValue = {
  objectiveId: string
  number: string
  metricKey: AutoMetricKey
  periodKey: string
  value: number
}

export type RefreshResult = {
  refreshed: RefreshedValue[]
  /** periods evaluated but unmeasurable (null) — skipped, no row written. */
  skippedNoData: number
  errors: string[]
}

/**
 * Recompute the auto-derived KPI values for every ACTIVE auto objective (or
 * the given subset). For each objective it walks the periods from the start of
 * the current Brisbane calendar year through the current period, and UPSERTs:
 *   - the CURRENT period always (a period-to-date figure that firms up as the
 *     period elapses), and
 *   - any ELAPSED period that has no stored value yet (backfill).
 * Stored historical values are left untouched; every write is captured by the
 * kpi_values audit trigger — that is the evidence trail.
 * A null computation is skipped (no row) — "no data" is never persisted as 0.
 *
 * Runs under the caller's RLS (admin/office can write kpi_values).
 */
export async function refreshObjectiveKpis(
  supabase: Supabase,
  objectiveIds?: string[]
): Promise<RefreshResult> {
  const today = todayAU()
  const anchor = `${today.slice(0, 4)}-01-01`

  let query = supabase
    .from('objectives')
    .select('id, number, period, auto_metric_key')
    .eq('status', 'active')
    .eq('source', 'auto')
  if (objectiveIds && objectiveIds.length > 0) {
    query = query.in('id', objectiveIds)
  }
  const { data: objectives, error } = await query
  if (error) throw new Error(`objectives query failed: ${error.message}`)

  const result: RefreshResult = { refreshed: [], skippedNoData: 0, errors: [] }

  for (const obj of objectives ?? []) {
    const metricKey = obj.auto_metric_key as AutoMetricKey
    const metric = AUTO_METRICS[metricKey]
    if (!metric) {
      result.errors.push(`${obj.number}: unknown metric '${obj.auto_metric_key}'`)
      continue
    }

    const period = obj.period as ObjectivePeriod
    const keys = enumeratePeriods(period, anchor, today)
    const currentKey = periodKeyFor(period, today)

    const { data: existing } = await supabase
      .from('kpi_values')
      .select('period_key')
      .eq('objective_id', obj.id as string)
    const stored = new Set((existing ?? []).map((r) => r.period_key as string))

    for (const key of keys) {
      const isCurrentPeriod = key === currentKey
      if (!isCurrentPeriod && stored.has(key)) continue // keep history as-is

      let value: number | null
      try {
        value = await metric.compute(supabase, key)
      } catch (err) {
        result.errors.push(
          `${obj.number} ${key}: ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }
      if (value == null) {
        result.skippedNoData++
        continue
      }

      const { error: upsertError } = await supabase.from('kpi_values').upsert(
        {
          objective_id: obj.id as string,
          period_key: key,
          value,
          entered_by: null,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'objective_id,period_key' }
      )
      if (upsertError) {
        result.errors.push(`${obj.number} ${key}: ${upsertError.message}`)
        continue
      }
      result.refreshed.push({
        objectiveId: obj.id as string,
        number: obj.number as string,
        metricKey,
        periodKey: key,
        value,
      })
    }
  }

  return result
}
