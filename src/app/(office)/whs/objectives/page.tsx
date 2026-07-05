import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { todayAU } from '@/lib/tz'
import {
  deriveObjectiveStatus,
  periodKeyFor,
  type ObjectiveTrafficStatus,
} from '@/lib/objectives'
import { latestKpiValue } from '@/lib/objective-queries'
import type {
  ObjectiveDirection,
  ObjectivePeriod,
  ObjectiveSource,
  ObjectiveStatus,
  RiskDomain,
} from '@/lib/zod'
import {
  ObjectivesClient,
  type ObjectiveCardRow,
  type HoursRow,
  type ProfileOption,
  type TrendPoint,
} from './objectives-client'

export default async function WhsObjectivesPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const [{ data: objectives }, { data: values }, { data: actions }, { data: hours }, { data: profileRows }] =
    await Promise.all([
      supabase
        .from('objectives')
        .select(
          `id, number, title, description, iso_domain, metric_name, unit,
           target_value, direction, period, source, auto_metric_key, status,
           owner:profiles!objectives_owner_id_fkey(full_name)`
        )
        .order('number'),
      supabase
        .from('kpi_values')
        .select('objective_id, period_key, value')
        .order('period_key'),
      supabase
        .from('objective_actions')
        .select('objective_id, status')
        .eq('status', 'open'),
      supabase
        .from('company_hours')
        .select('period_key, hours')
        .order('period_key', { ascending: false })
        .limit(12),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name'),
    ])

  const today = todayAU()

  const valuesByObjective = new Map<string, { period_key: string; value: number }[]>()
  for (const v of values ?? []) {
    const key = v.objective_id as string
    const row = { period_key: v.period_key as string, value: Number(v.value) }
    const list = valuesByObjective.get(key)
    if (list) list.push(row)
    else valuesByObjective.set(key, [row])
  }

  const openActionsByObjective = new Map<string, number>()
  for (const a of actions ?? []) {
    const key = a.objective_id as string
    openActionsByObjective.set(key, (openActionsByObjective.get(key) ?? 0) + 1)
  }

  const rows: ObjectiveCardRow[] = (objectives ?? []).map((o) => {
    const series = valuesByObjective.get(o.id as string) ?? []
    const latest = latestKpiValue(series)
    const direction = o.direction as ObjectiveDirection
    const target = Number(o.target_value)
    const status: ObjectiveTrafficStatus = deriveObjectiveStatus(
      direction,
      target,
      latest?.value ?? null
    )
    // Last 12 stored periods, oldest → newest, for the sparkline.
    const trend: TrendPoint[] = series
      .slice(-12)
      .map((v) => ({ period: v.period_key, value: v.value }))
    const owner = o.owner as unknown as { full_name: string } | null
    return {
      id: o.id as string,
      number: o.number as string,
      title: o.title as string,
      iso_domain: o.iso_domain as RiskDomain,
      metric_name: o.metric_name as string,
      unit: o.unit as string,
      target_value: target,
      direction,
      period: o.period as ObjectivePeriod,
      source: o.source as ObjectiveSource,
      status: o.status as ObjectiveStatus,
      owner_name: owner?.full_name ?? null,
      latest_period: latest?.period_key ?? null,
      latest_value: latest?.value ?? null,
      traffic: status,
      trend,
      open_action_count: openActionsByObjective.get(o.id as string) ?? 0,
      is_current_period:
        latest != null &&
        latest.period_key === periodKeyFor(o.period as ObjectivePeriod, today),
    }
  })

  const hoursRows: HoursRow[] = (hours ?? []).map((h) => ({
    period_key: h.period_key as string,
    hours: Number(h.hours),
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Objectives & KPIs"
        description="Measurable management objectives with period-by-period actuals — auto-derived from the live registers or entered manually (ISO 9001/14001/45001 §6.2, §9.1). Objectives are set and reviewed per SMS-01 Objectives and Targets Procedure; this register carries the SMS-R-04 Performance Register."
      />
      <ObjectivesClient
        items={rows}
        hours={hoursRows}
        profiles={profileOptions}
        canManage={profile.role === 'admin' || profile.role === 'office'}
        currentMonth={periodKeyFor('monthly', today)}
      />
    </div>
  )
}
