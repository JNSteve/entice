'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { canPublishVariation } from '@/lib/portal-interactions'
import {
  variationCreateSchema,
  variationUpdateSchema,
  variationStatusSchema,
} from '@/lib/zod'

type Result = { error?: string }

// Legal transition map: from → allowed-to
const VALID_TRANSITIONS: Record<string, string[]> = {
  notified: ['priced'],
  priced: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: [],
  rejected: [],
}

// Fields that become read-only once approved or rejected
const TERMINAL = new Set(['approved', 'rejected'])

function revalidateVariation(projectId: string) {
  revalidatePath(`/projects/${projectId}/variations`)
  revalidatePath(`/projects/${projectId}`)
}

// ─── Create variation ─────────────────────────────────────────────────────────

export async function createVariation(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = variationCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Verify project exists
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', parsed.data.project_id)
    .single()
  if (!project) return { error: 'Project not found' }

  // Destructure for use inside nested async function (TypeScript narrowing)
  const inputData = parsed.data

  // Get max number for this project (race-tolerable: retry once on unique violation)
  async function insertVariation(retries = 1): Promise<{ error?: string; id?: string }> {
    const { data: maxRow } = await supabase
      .from('variations')
      .select('number')
      .eq('project_id', inputData.project_id)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextNumber = (maxRow?.number ?? 0) + 1

    const { data: row, error } = await supabase
      .from('variations')
      .insert({
        project_id: inputData.project_id,
        number: nextNumber,
        title: inputData.title,
        description: inputData.description ?? null,
        status: 'notified',
        cost_estimate: inputData.cost_estimate ?? 0,
        sell_amount: inputData.sell_amount ?? 0,
        client_ref: inputData.client_ref ?? null,
        time_bar_date: inputData.time_bar_date ?? null,
        notes: inputData.notes ?? null,
      })
      .select('id')
      .single()

    if (error) {
      // 23505 = unique_violation — retry once with fresh max number
      if (error.code === '23505' && retries > 0) {
        return insertVariation(retries - 1)
      }
      return { error: error.message }
    }

    return { id: row.id }
  }

  const result = await insertVariation()
  if (result.error) return result

  revalidateVariation(parsed.data.project_id)
  return { id: result.id }
}

// ─── Update variation (fields, not status) ────────────────────────────────────

export async function updateVariation(
  variationId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = variationUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: variation } = await supabase
    .from('variations')
    .select('id, status')
    .eq('id', variationId)
    .eq('project_id', projectId)
    .single()
  if (!variation) return { error: 'Variation not found' }

  // If terminal, only notes can be updated
  if (TERMINAL.has(variation.status)) {
    const { notes, ...rest } = parsed.data
    const hasNonNotes = Object.keys(rest).length > 0
    if (hasNonNotes) {
      return { error: 'Only notes can be edited once a variation is approved or rejected' }
    }
    if (notes !== undefined) {
      const { error } = await supabase
        .from('variations')
        .update({ notes: notes ?? null })
        .eq('id', variationId)
      if (error) return { error: error.message }
    }
    revalidateVariation(projectId)
    return {}
  }

  // Lock sell_amount for approved variations (defensive — already checked above)
  const update: Record<string, unknown> = { ...parsed.data }
  if (variation.status === 'approved') {
    delete update.sell_amount
  }

  // DB columns are NOT NULL — coerce null to 0 for numeric fields
  if ('cost_estimate' in update && update.cost_estimate == null) update.cost_estimate = 0
  if ('sell_amount' in update && update.sell_amount == null) update.sell_amount = 0

  const { error } = await supabase
    .from('variations')
    .update(update)
    .eq('id', variationId)

  if (error) return { error: error.message }

  revalidateVariation(projectId)
  return {}
}

// ─── Status transition ─────────────────────────────────────────────────────────

export async function setVariationStatus(
  variationId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = variationStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: variation } = await supabase
    .from('variations')
    .select('id, status')
    .eq('id', variationId)
    .eq('project_id', projectId)
    .single()
  if (!variation) return { error: 'Variation not found' }

  const allowed = VALID_TRANSITIONS[variation.status] ?? []
  if (!allowed.includes(parsed.data.status)) {
    return {
      error: `Cannot move a variation from ${variation.status} to ${parsed.data.status}`,
    }
  }

  const update: Record<string, unknown> = { status: parsed.data.status }

  if (parsed.data.status === 'submitted') {
    update.submitted_at = new Date().toISOString()
  }
  if (parsed.data.status === 'approved' || parsed.data.status === 'rejected') {
    update.decided_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('variations')
    .update(update)
    .eq('id', variationId)

  if (error) return { error: error.message }

  revalidateVariation(projectId)
  return {}
}

// ─── Portal publishing (CP2b sign-on-the-glass) ───────────────────────────────

/**
 * Only a SUBMITTED variation can be published — that is the one status the
 * portal may approve from (mirrors setVariationStatus submitted→approved).
 * Unpublishing is allowed anytime.
 */
export async function setVariationPortalPublished(
  variationId: string,
  projectId: string,
  published: boolean
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: variation } = await supabase
    .from('variations')
    .select('id, status')
    .eq('id', variationId)
    .eq('project_id', projectId)
    .single()
  if (!variation) return { error: 'Variation not found' }

  if (published && !canPublishVariation(variation.status)) {
    return { error: 'Only a submitted variation can be published to the portal' }
  }

  const { error } = await supabase
    .from('variations')
    .update({ portal_published: published })
    .eq('id', variationId)
  if (error) return { error: error.message }

  revalidateVariation(projectId)
  return {}
}
