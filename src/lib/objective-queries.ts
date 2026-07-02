// Server-side Objectives & KPIs queries (ISO 6.2 / 9.1), shared by the
// objectives register page and the WHS overview "Needs attention" card.
// Traffic-light status is DERIVED at read time from the latest stored period
// value via the pure logic in src/lib/objectives.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deriveObjectiveStatus,
  periodKeyLabel,
  type ObjectiveTrafficStatus,
} from '@/lib/objectives'
import type { ObjectiveDirection } from '@/lib/zod'

export type KpiValueLike = {
  period_key: string
  value: number
}

/**
 * The latest stored value for an objective: period keys sort chronologically
 * within a period type ('2026-01' < '2026-02'; '2026-Q1' < '2026-Q2'), so the
 * lexicographically greatest key is the most recent period with data.
 */
export function latestKpiValue<T extends KpiValueLike>(values: T[]): T | null {
  let latest: T | null = null
  for (const v of values) {
    if (!latest || v.period_key > latest.period_key) latest = v
  }
  return latest
}

export type ObjectiveAttentionRow = {
  id: string
  number: string
  title: string
  metricName: string
  unit: string
  periodLabel: string
  value: number
  target: number
  direction: ObjectiveDirection
}

/**
 * ACTIVE objectives whose latest stored KPI value is OFF-TRACK against the
 * direction-aware target — the WHS overview "Needs attention" rows.
 * Objectives with no data yet are not flagged here (the dashboard shows the
 * grey no-data state); off-track means measured and missing the target.
 */
export async function fetchObjectiveAttention(
  supabase: SupabaseClient
): Promise<ObjectiveAttentionRow[]> {
  const [{ data: objectives }, { data: values }] = await Promise.all([
    supabase
      .from('objectives')
      .select('id, number, title, metric_name, unit, target_value, direction')
      .eq('status', 'active')
      .order('number'),
    supabase.from('kpi_values').select('objective_id, period_key, value'),
  ])

  const valuesByObjective = new Map<string, KpiValueLike[]>()
  for (const v of values ?? []) {
    const key = v.objective_id as string
    const row = { period_key: v.period_key as string, value: Number(v.value) }
    const list = valuesByObjective.get(key)
    if (list) list.push(row)
    else valuesByObjective.set(key, [row])
  }

  const rows: ObjectiveAttentionRow[] = []
  for (const o of objectives ?? []) {
    const latest = latestKpiValue(valuesByObjective.get(o.id as string) ?? [])
    if (!latest) continue
    const status: ObjectiveTrafficStatus = deriveObjectiveStatus(
      o.direction as ObjectiveDirection,
      Number(o.target_value),
      latest.value
    )
    if (status !== 'off_track') continue
    rows.push({
      id: o.id as string,
      number: o.number as string,
      title: o.title as string,
      metricName: o.metric_name as string,
      unit: o.unit as string,
      periodLabel: periodKeyLabel(latest.period_key),
      value: latest.value,
      target: Number(o.target_value),
      direction: o.direction as ObjectiveDirection,
    })
  }
  return rows
}
