import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAuditFor } from '@/lib/audit-queries'
import type { AuditRow } from '@/lib/audit-queries'
import { todayAU } from '@/lib/tz'
import { periodKeyFor } from '@/lib/objectives'
import type {
  ObjectiveDirection,
  ObjectivePeriod,
  ObjectiveSource,
  ObjectiveStatus,
  RiskDomain,
} from '@/lib/zod'
import type { ProfileOption } from '../objectives-client'
import {
  ObjectiveDetailClient,
  type ObjectiveDetailData,
  type KpiValueRow,
  type ActionRow,
} from './objective-detail'

export default async function ObjectiveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: objective },
    { data: values },
    { data: actions },
    { data: profileRows },
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('objectives')
      .select(
        `id, number, title, description, iso_domain, metric_name, unit,
         target_value, direction, period, source, auto_metric_key, status,
         owner_id, created_at,
         owner:profiles!objectives_owner_id_fkey(full_name),
         creator:profiles!objectives_created_by_fkey(full_name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('kpi_values')
      .select(
        `id, period_key, value, note, entered_by, computed_at,
         enterer:profiles!kpi_values_entered_by_fkey(full_name)`
      )
      .eq('objective_id', id)
      .order('period_key', { ascending: false }),
    supabase
      .from('objective_actions')
      .select(
        `id, objective_id, description, assigned_to, due_date, status, completed_at,
         profiles!objective_actions_assigned_to_fkey(full_name)`
      )
      .eq('objective_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
    fetchAuditFor(supabase, 'objectives', id),
  ])

  if (!objective) notFound()

  const owner = objective.owner as unknown as { full_name: string } | null
  const creator = objective.creator as unknown as { full_name: string } | null

  const data: ObjectiveDetailData = {
    id: objective.id as string,
    number: objective.number as string,
    title: objective.title as string,
    description: (objective.description as string | null) ?? null,
    iso_domain: objective.iso_domain as RiskDomain,
    metric_name: objective.metric_name as string,
    unit: objective.unit as string,
    target_value: Number(objective.target_value),
    direction: objective.direction as ObjectiveDirection,
    period: objective.period as ObjectivePeriod,
    source: objective.source as ObjectiveSource,
    auto_metric_key: (objective.auto_metric_key as string | null) ?? null,
    status: objective.status as ObjectiveStatus,
    owner_id: (objective.owner_id as string | null) ?? null,
    owner_name: owner?.full_name ?? null,
    created_by_name: creator?.full_name ?? null,
    created_at: objective.created_at as string,
  }

  const valueRows: KpiValueRow[] = (values ?? []).map((v) => {
    const enterer = v.enterer as unknown as { full_name: string } | null
    return {
      id: v.id as string,
      period_key: v.period_key as string,
      value: Number(v.value),
      note: (v.note as string | null) ?? null,
      entered_by_name: enterer?.full_name ?? null,
      computed_at: v.computed_at as string,
    }
  })

  const actionRows: ActionRow[] = (actions ?? []).map((a) => {
    const assignee = a.profiles as unknown as { full_name: string } | null
    return {
      id: a.id as string,
      description: a.description as string,
      assigned_to: (a.assigned_to as string | null) ?? null,
      assigned_to_name: assignee?.full_name ?? null,
      due_date: (a.due_date as string | null) ?? null,
      status: a.status as 'open' | 'done',
      completed_at: (a.completed_at as string | null) ?? null,
    }
  })

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/whs/objectives"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Objectives & KPIs
      </Link>
      <ObjectiveDetailClient
        objective={data}
        values={valueRows}
        actions={actionRows}
        role={profile.role as 'admin' | 'office' | 'supervisor'}
        profiles={profileOptions}
        auditHistory={auditHistory as AuditRow[]}
        currentPeriod={periodKeyFor(data.period, todayAU())}
      />
    </div>
  )
}
