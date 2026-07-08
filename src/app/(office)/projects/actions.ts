'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { resolveBudgetLine } from '@/lib/budget-lines'
import { nextNumber } from '@/lib/numbering'
import { syncRequestsForQuote } from '@/lib/notify'
import { todayAU } from '@/lib/tz'
import {
  PROJECT_STATUSES,
  projectCreateSchema,
  projectUpdateSchema,
  budgetLineSchema,
  budgetLineUpdateSchema,
  projectChecklistItemSchema,
  projectCostSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateProject(projectId: string) {
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/budget`)
}

// ─── Project CRUD ─────────────────────────────────────────────────────────────

export async function createProject(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = projectCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Verify client exists and is not archived.
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', parsed.data.client_id)
    .eq('archived', false)
    .single()
  if (!client) return { error: 'Client not found or archived' }

  let number: string
  try {
    number = await nextNumber(supabase, 'project')
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Failed to allocate project number',
    }
  }

  const { data: row, error } = await supabase
    .from('projects')
    .insert({
      number,
      client_id: parsed.data.client_id,
      site_id: parsed.data.site_id,
      name: parsed.data.name,
      description: parsed.data.description,
      contract_sum: parsed.data.contract_sum,
      retention_pct: parsed.data.retention_pct,
      retention_cap_pct: parsed.data.retention_cap_pct,
      dlp_months: parsed.data.dlp_months,
      claim_day: parsed.data.claim_day,
      start_date: parsed.data.start_date,
      supervisor_id: parsed.data.supervisor_id,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/projects')
  return { id: row.id }
}

/**
 * Updates project details. When `status` is present, validates the
 * forward-only chain: active → practical_completion → defects_liability → closed
 * (one step at a time). Moving to practical_completion stamps
 * practical_completion_date with today when it is not already set.
 */
export async function updateProject(
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = projectUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const update: Record<string, unknown> = { ...parsed.data }
  let quoteIdForSync: string | null = null

  if (parsed.data.status !== undefined) {
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('id, status, practical_completion_date, quote_id')
      .eq('id', projectId)
      .single()
    if (fetchError || !project) return { error: 'Project not found' }
    quoteIdForSync = (project.quote_id as string | null) ?? null

    const fromIndex = PROJECT_STATUSES.indexOf(
      project.status as (typeof PROJECT_STATUSES)[number]
    )
    const toIndex = PROJECT_STATUSES.indexOf(parsed.data.status)
    if (toIndex !== fromIndex + 1) {
      return {
        error: `Cannot move a ${project.status.replaceAll('_', ' ')} project to ${parsed.data.status.replaceAll('_', ' ')}`,
      }
    }

    if (
      parsed.data.status === 'practical_completion' &&
      !project.practical_completion_date
    ) {
      update.practical_completion_date = todayAU()
    }
  }

  const { error } = await supabase
    .from('projects')
    .update(update)
    .eq('id', projectId)

  if (error) return { error: error.message }

  // Project closed → linked portal request 'completed' (closed is the
  // client-facing done state — matches workGroupForProject). Fire-and-forget
  // after the response.
  if (parsed.data.status === 'closed' && quoteIdForSync) {
    const quoteId = quoteIdForSync
    after(() => syncRequestsForQuote(quoteId, 'work_completed'))
  }

  revalidateProject(projectId)
  return {}
}

// ─── Budget lines ─────────────────────────────────────────────────────────────

export async function addBudgetLine(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = budgetLineSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Get next position
  const { data: last } = await supabase
    .from('budget_lines')
    .select('position')
    .eq('project_id', parsed.data.project_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('budget_lines').insert({
    project_id: parsed.data.project_id,
    cost_code_id: parsed.data.cost_code_id,
    description: parsed.data.description,
    budget_amount: parsed.data.budget_amount,
    position: (last?.position ?? -1) + 1,
  })
  if (error) return { error: error.message }

  revalidateProject(parsed.data.project_id)
  return {}
}

export async function updateBudgetLine(
  lineId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = budgetLineUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('budget_lines')
    .update(parsed.data)
    .eq('id', lineId)
    .eq('project_id', projectId)

  if (error) return { error: error.message }

  revalidateProject(projectId)
  return {}
}

export async function deleteBudgetLine(
  lineId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('budget_lines')
    .delete()
    .eq('id', lineId)
    .eq('project_id', projectId)

  if (error) return { error: error.message }

  revalidateProject(projectId)
  return {}
}

// ─── Costs ────────────────────────────────────────────────────────────────────

export async function addProjectCost(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = projectCostSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // A linked budget line must belong to this project, and the line's cost
  // code wins — the budget rollup attributes by budget_line_id first.
  let costCodeId = parsed.data.cost_code_id
  if (parsed.data.budget_line_id) {
    const line = await resolveBudgetLine(supabase, parsed.data.budget_line_id, parsed.data.project_id)
    if (line.error) return { error: line.error }
    costCodeId = line.costCodeId ?? costCodeId
  }

  const { error } = await supabase.from('costs').insert({
    parent_type: 'project',
    parent_id: parsed.data.project_id,
    date: parsed.data.date,
    description: parsed.data.description,
    amount: parsed.data.amount,
    cost_code_id: costCodeId,
    budget_line_id: parsed.data.budget_line_id,
    source: 'manual',
    created_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidateProject(parsed.data.project_id)
  return {}
}

// ─── Mobilisation checklist ───────────────────────────────────────────────────

export async function addProjectChecklistItem(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = projectChecklistItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: last } = await supabase
    .from('project_checklist_items')
    .select('position')
    .eq('project_id', parsed.data.project_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('project_checklist_items').insert({
    project_id: parsed.data.project_id,
    text: parsed.data.text,
    position: (last?.position ?? -1) + 1,
    done: false,
  })
  if (error) return { error: error.message }

  revalidateProject(parsed.data.project_id)
  return {}
}

export async function toggleProjectChecklistItem(
  itemId: string,
  projectId: string,
  done: boolean
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const supabase = await createClient()

  const update = done
    ? { done: true, done_by: profile.id, done_at: new Date().toISOString() }
    : { done: false, done_by: null, done_at: null }

  const { error } = await supabase
    .from('project_checklist_items')
    .update(update)
    .eq('id', itemId)
    .eq('project_id', projectId)
  if (error) return { error: error.message }

  revalidateProject(projectId)
  return {}
}

export async function deleteProjectChecklistItem(
  itemId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { error } = await supabase
    .from('project_checklist_items')
    .delete()
    .eq('id', itemId)
    .eq('project_id', projectId)
  if (error) return { error: error.message }

  revalidateProject(projectId)
  return {}
}
