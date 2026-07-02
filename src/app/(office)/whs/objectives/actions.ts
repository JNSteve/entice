'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { todayAU } from '@/lib/tz'
import {
  AUTO_METRIC_KEYS,
  periodKeyFor,
  periodRangeOf,
  type AutoMetricKey,
} from '@/lib/objectives'
import { refreshObjectiveKpis, type RefreshResult } from '@/lib/kpi-metrics'
import {
  objectiveCreateSchema,
  objectiveUpdateSchema,
  objectiveStatusSchema,
  kpiManualValueSchema,
  companyHoursSchema,
  objectiveActionSchema,
  objectiveActionUpdateSchema,
  type ObjectivePeriod,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateObjectives(objectiveId?: string) {
  revalidatePath('/whs/objectives')
  revalidatePath('/whs')
  if (objectiveId) revalidatePath(`/whs/objectives/${objectiveId}`)
}

// ─── Objectives (admin/office manage — matches RLS) ──────────────────────────

export async function createObjective(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = objectiveCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  if (
    parsed.data.source === 'auto' &&
    !AUTO_METRIC_KEYS.includes(parsed.data.auto_metric_key as AutoMetricKey)
  ) {
    return { error: 'Unknown auto metric' }
  }

  const supabase = await createClient()

  const number = await nextNumber(supabase, 'objective').catch((err) => {
    throw new Error(`Failed to get next objective number: ${err.message}`)
  })

  const { data: row, error } = await supabase
    .from('objectives')
    .insert({
      number,
      title: parsed.data.title,
      description: parsed.data.description,
      iso_domain: parsed.data.iso_domain,
      metric_name: parsed.data.metric_name,
      unit: parsed.data.unit,
      target_value: parsed.data.target_value,
      direction: parsed.data.direction,
      period: parsed.data.period,
      source: parsed.data.source,
      auto_metric_key: parsed.data.auto_metric_key,
      owner_id: parsed.data.owner_id,
      status: 'active',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateObjectives(row.id)
  return { id: row.id }
}

export async function updateObjective(
  objectiveId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = objectiveUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('objectives')
    .select('id, status')
    .eq('id', objectiveId)
    .single()
  if (!existing) return { error: 'Objective not found' }
  if (existing.status === 'retired') {
    return { error: 'Cannot edit a retired objective — reactivate it first' }
  }

  const { data: updated, error } = await supabase
    .from('objectives')
    .update(parsed.data)
    .eq('id', objectiveId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateObjectives(objectiveId)
  return {}
}

export async function setObjectiveStatus(
  objectiveId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = objectiveStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('objectives')
    .update({ status: parsed.data.status })
    .eq('id', objectiveId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateObjectives(objectiveId)
  return {}
}

export async function deleteObjective(objectiveId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { error } = await supabase
    .from('objectives')
    .delete()
    .eq('id', objectiveId)
  if (error) return { error: error.message }

  revalidateObjectives()
  return {}
}

// ─── Manual KPI values (manual objectives ONLY — non-bypassable guard) ───────

export async function enterManualKpiValue(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = kpiManualValueSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: objective } = await supabase
    .from('objectives')
    .select('id, source, period, status')
    .eq('id', parsed.data.objective_id)
    .single()
  if (!objective) return { error: 'Objective not found' }

  // One source per objective: manual entry never lands on an auto objective.
  // (The kpi_values entry-guard trigger enforces the same rule in the DB.)
  if (objective.source !== 'manual') {
    return {
      error:
        'This objective is auto-derived — its values come from Refresh metrics, not manual entry',
    }
  }

  const period = objective.period as ObjectivePeriod
  const expected = period === 'monthly' ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}-Q[1-4]$/
  if (!expected.test(parsed.data.period_key)) {
    return {
      error:
        period === 'monthly'
          ? 'This objective is monthly — use a YYYY-MM period'
          : 'This objective is quarterly — use a YYYY-Qn period',
    }
  }

  // Only current or elapsed periods — a future value is not a record.
  const today = todayAU()
  if (periodRangeOf(parsed.data.period_key).start > today) {
    return { error: 'Cannot record a value for a future period' }
  }

  const { error } = await supabase.from('kpi_values').upsert(
    {
      objective_id: parsed.data.objective_id,
      period_key: parsed.data.period_key,
      value: parsed.data.value,
      note: parsed.data.note,
      entered_by: profile.id,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'objective_id,period_key' }
  )
  if (error) return { error: error.message }

  revalidateObjectives(parsed.data.objective_id)
  return {}
}

// ─── Company hours (LTIFR denominator — manual monthly payroll figure) ───────

export async function upsertCompanyHours(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = companyHoursSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  // Only current or elapsed months — hours are a payroll record, not a forecast.
  const today = todayAU()
  if (parsed.data.period_key > periodKeyFor('monthly', today)) {
    return { error: 'Cannot enter hours for a future month' }
  }

  const supabase = await createClient()

  const { error } = await supabase.from('company_hours').upsert(
    {
      period_key: parsed.data.period_key,
      hours: parsed.data.hours,
      entered_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'period_key' }
  )
  if (error) return { error: error.message }

  revalidateObjectives()
  return {}
}

// ─── Refresh metrics (admin/office) ───────────────────────────────────────────

export async function refreshKpis(
  objectiveIds?: string[]
): Promise<{ error?: string; result?: RefreshResult }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  try {
    const result = await refreshObjectiveKpis(supabase, objectiveIds)
    revalidateObjectives(objectiveIds?.length === 1 ? objectiveIds[0] : undefined)
    return { result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Refresh failed' }
  }
}

// ─── Improvement actions ──────────────────────────────────────────────────────

export async function createObjectiveAction(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = objectiveActionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('objective_actions')
    .insert({
      objective_id: parsed.data.objective_id,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateObjectives(parsed.data.objective_id)
  return { id: row.id }
}

export async function updateObjectiveAction(
  actionId: string,
  objectiveId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = objectiveActionUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('objective_actions')
    .update(parsed.data)
    .eq('id', actionId)
    .eq('objective_id', objectiveId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateObjectives(objectiveId)
  return {}
}

export async function setObjectiveActionDone(
  actionId: string,
  objectiveId: string,
  done: boolean
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('objective_actions')
    .update(
      done
        ? { status: 'done', completed_at: new Date().toISOString() }
        : { status: 'open', completed_at: null }
    )
    .eq('id', actionId)
    .eq('objective_id', objectiveId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateObjectives(objectiveId)
  return {}
}

export async function deleteObjectiveAction(
  actionId: string,
  objectiveId: string
): Promise<Result> {
  // RLS only allows admins to delete.
  await requireRole('admin')

  const supabase = await createClient()

  const { error } = await supabase
    .from('objective_actions')
    .delete()
    .eq('id', actionId)
    .eq('objective_id', objectiveId)
  if (error) return { error: error.message }

  revalidateObjectives(objectiveId)
  return {}
}
