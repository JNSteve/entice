'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { riskTransitionAllowed, riskCloseError } from '@/lib/risk'
import {
  riskItemCreateSchema,
  riskItemUpdateSchema,
  riskStatusSchema,
  riskTreatmentSchema,
  riskTreatmentUpdateSchema,
  type RiskKind,
  type RiskStatus,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateRisk(riskId?: string, projectId?: string | null) {
  revalidatePath('/whs/risks')
  revalidatePath('/whs')
  if (riskId) revalidatePath(`/whs/risks/${riskId}`)
  if (projectId) revalidatePath(`/projects/${projectId}/risk`)
}

// ─── Create (admin/office/supervisor — supervisors may raise risks) ──────────

export async function createRiskItem(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = riskItemCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const number = await nextNumber(supabase, 'risk').catch((err) => {
    throw new Error(`Failed to get next risk number: ${err.message}`)
  })

  const { data: row, error } = await supabase
    .from('risk_items')
    .insert({
      number,
      kind: parsed.data.kind,
      title: parsed.data.title,
      context: parsed.data.context,
      source: parsed.data.source,
      iso_domain: parsed.data.iso_domain,
      project_id: parsed.data.project_id,
      category: parsed.data.category,
      existing_controls: parsed.data.existing_controls,
      likelihood: parsed.data.likelihood,
      consequence: parsed.data.consequence,
      residual_likelihood: parsed.data.residual_likelihood,
      residual_consequence: parsed.data.residual_consequence,
      owner_id: parsed.data.owner_id,
      review_date: parsed.data.review_date,
      status: 'open',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateRisk(row.id, parsed.data.project_id)
  return { id: row.id }
}

// ─── Update fields (admin/office — matches the RLS update policy) ────────────

export async function updateRiskItem(
  riskId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = riskItemUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('risk_items')
    .select('id, status, project_id')
    .eq('id', riskId)
    .single()
  if (!existing) return { error: 'Risk item not found' }
  if (existing.status === 'closed') {
    return { error: 'Cannot edit a closed item — reopen it first' }
  }

  const { data: updated, error } = await supabase
    .from('risk_items')
    .update(parsed.data)
    .eq('id', riskId)
    .select('id, project_id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateRisk(riskId, updated[0].project_id ?? existing.project_id)
  return {}
}

// ─── Status transitions + close gates (NON-BYPASSABLE) ────────────────────────

export async function setRiskStatus(
  riskId: string,
  data: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = riskStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('risk_items')
    .select('id, status, kind, residual_likelihood, residual_consequence, project_id')
    .eq('id', riskId)
    .single()
  if (!existing) return { error: 'Risk item not found' }

  const from = existing.status as RiskStatus
  const target = parsed.data.status

  if (!riskTransitionAllowed(from, target)) {
    return { error: `Cannot move from ${from} to ${target}` }
  }

  // Reopen (closed → open) is admin-only.
  if (from === 'closed' && profile.role !== 'admin') {
    return { error: 'Only admins can reopen a closed item' }
  }

  // ── Close gates ────────────────────────────────────────────────────────────
  // 1. Nothing closes while it has open treatments.
  // 2. A RISK cannot close without residual likelihood/consequence recorded
  //    (evidence the treatments worked). Opportunities are exempt.
  if (target === 'closed') {
    const { count: openTreatments } = await supabase
      .from('risk_treatments')
      .select('id', { count: 'exact', head: true })
      .eq('risk_item_id', riskId)
      .eq('status', 'open')

    const gate = riskCloseError(
      {
        kind: existing.kind as RiskKind,
        residual_likelihood: existing.residual_likelihood as number | null,
        residual_consequence: existing.residual_consequence as number | null,
      },
      openTreatments ?? 0
    )
    if (gate) return { error: gate }
  }

  const update: Record<string, unknown> = { status: target }
  if (target === 'closed') {
    update.closed_at = new Date().toISOString()
  } else if (from === 'closed') {
    update.closed_at = null
  }

  const { data: updated, error } = await supabase
    .from('risk_items')
    .update(update)
    .eq('id', riskId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateRisk(riskId, existing.project_id as string | null)
  return {}
}

// ─── Delete (admin only — matches RLS) ────────────────────────────────────────

export async function deleteRiskItem(riskId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('risk_items')
    .select('id, project_id')
    .eq('id', riskId)
    .single()
  if (!existing) return { error: 'Risk item not found' }

  const { error } = await supabase.from('risk_items').delete().eq('id', riskId)
  if (error) return { error: error.message }

  revalidateRisk(undefined, existing.project_id as string | null)
  return {}
}

// ─── Treatments ───────────────────────────────────────────────────────────────

// Treatments may only be mutated while the parent item is not closed — a
// closed item's record is settled; reopen it (admin) to change treatments.
async function riskTreatmentsLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  riskId: string
): Promise<{ error: string | null; projectId: string | null }> {
  const { data: parent } = await supabase
    .from('risk_items')
    .select('status, project_id')
    .eq('id', riskId)
    .single()
  if (!parent) return { error: 'Risk item not found', projectId: null }
  if (parent.status === 'closed') {
    return {
      error: 'This item is closed — reopen it to change its treatments.',
      projectId: parent.project_id as string | null,
    }
  }
  return { error: null, projectId: parent.project_id as string | null }
}

export async function createRiskTreatment(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = riskTreatmentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const locked = await riskTreatmentsLocked(supabase, parsed.data.risk_item_id)
  if (locked.error) return { error: locked.error }

  const { data: row, error } = await supabase
    .from('risk_treatments')
    .insert({
      risk_item_id: parsed.data.risk_item_id,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateRisk(parsed.data.risk_item_id, locked.projectId)
  return { id: row.id }
}

export async function updateRiskTreatment(
  treatmentId: string,
  riskId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = riskTreatmentUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const locked = await riskTreatmentsLocked(supabase, riskId)
  if (locked.error) return { error: locked.error }

  const { data: updated, error } = await supabase
    .from('risk_treatments')
    .update(parsed.data)
    .eq('id', treatmentId)
    .eq('risk_item_id', riskId)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateRisk(riskId, locked.projectId)
  return {}
}

export async function deleteRiskTreatment(
  treatmentId: string,
  riskId: string
): Promise<Result> {
  // RLS only allows admins to delete treatments.
  await requireRole('admin')

  const supabase = await createClient()

  const locked = await riskTreatmentsLocked(supabase, riskId)
  if (locked.error) return { error: locked.error }

  const { error } = await supabase
    .from('risk_treatments')
    .delete()
    .eq('id', treatmentId)
    .eq('risk_item_id', riskId)

  if (error) return { error: error.message }

  revalidateRisk(riskId, locked.projectId)
  return {}
}

/** Mark done — supervisors may complete treatments assigned to them (RLS
 *  enforces the assignment; a zero-row update surfaces as an error, never a
 *  silent no-op). */
export async function markRiskTreatmentDone(
  treatmentId: string,
  riskId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const locked = await riskTreatmentsLocked(supabase, riskId)
  if (locked.error) return { error: locked.error }

  const { data: updated, error } = await supabase
    .from('risk_treatments')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', treatmentId)
    .eq('risk_item_id', riskId)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Not updated — you can only complete treatments assigned to you' }
  }

  revalidateRisk(riskId, locked.projectId)
  return {}
}

export async function reopenRiskTreatment(
  treatmentId: string,
  riskId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const locked = await riskTreatmentsLocked(supabase, riskId)
  if (locked.error) return { error: locked.error }

  const { data: updated, error } = await supabase
    .from('risk_treatments')
    .update({ status: 'open', completed_at: null })
    .eq('id', treatmentId)
    .eq('risk_item_id', riskId)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Not updated — you can only reopen treatments assigned to you' }
  }

  revalidateRisk(riskId, locked.projectId)
  return {}
}
