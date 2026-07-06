'use server'

// ITP template builder actions (Settings → ITP templates). Templates are the
// REUSABLE plans; adopting one onto a project COPIES its items into an
// instance, so edits here never silently change an in-flight ITP.

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { itpTemplateItemSchema, itpTemplateSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateSettings() {
  revalidatePath('/settings')
}

export async function upsertItpTemplate(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin')

  const parsed = itpTemplateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const fields = {
    name: parsed.data.name,
    activity: parsed.data.activity,
    discipline: parsed.data.discipline ?? null,
    active: parsed.data.active,
  }

  if (parsed.data.id) {
    const { error } = await supabase
      .from('itp_templates')
      .update(fields)
      .eq('id', parsed.data.id)
    if (error) return { error: error.message }
    revalidateSettings()
    return { id: parsed.data.id }
  }

  const { data: row, error } = await supabase
    .from('itp_templates')
    .insert({ ...fields, created_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateSettings()
  return { id: row.id }
}

export async function setItpTemplateActive(
  id: string,
  active: boolean
): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { error } = await supabase
    .from('itp_templates')
    .update({ active })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateSettings()
  return {}
}

export async function deleteItpTemplate(id: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  // Adopted templates are referenced by instances — deactivate instead.
  const { data: adopted } = await supabase
    .from('itp_instances')
    .select('id')
    .eq('template_id', id)
    .limit(1)
  if (adopted && adopted.length > 0) {
    return {
      error:
        'This template has been adopted on a project — deactivate it instead of deleting (adopted ITPs keep their copied items either way)',
    }
  }

  const { error } = await supabase.from('itp_templates').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidateSettings()
  return {}
}

export async function upsertItpTemplateItem(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin')

  const parsed = itpTemplateItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const fields = {
    description: parsed.data.description,
    acceptance_criteria: parsed.data.acceptance_criteria,
    spec_ref: parsed.data.spec_ref ?? null,
    point_type: parsed.data.point_type,
    record_required: parsed.data.record_required,
    responsible: parsed.data.responsible ?? null,
  }

  if (parsed.data.id) {
    const { error } = await supabase
      .from('itp_template_items')
      .update(fields)
      .eq('id', parsed.data.id)
      .eq('template_id', parsed.data.template_id)
    if (error) return { error: error.message }
    revalidateSettings()
    return { id: parsed.data.id }
  }

  // Append at the end of the template's items.
  const { data: maxRow } = await supabase
    .from('itp_template_items')
    .select('position')
    .eq('template_id', parsed.data.template_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: row, error } = await supabase
    .from('itp_template_items')
    .insert({
      ...fields,
      template_id: parsed.data.template_id,
      position: (maxRow?.position ?? 0) + 1,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateSettings()
  return { id: row.id }
}

export async function deleteItpTemplateItem(
  id: string,
  templateId: string
): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { error } = await supabase
    .from('itp_template_items')
    .delete()
    .eq('id', id)
    .eq('template_id', templateId)
  if (error) return { error: error.message }

  revalidateSettings()
  return {}
}

/** Reorder: swaps positions with the neighbour above/below. */
export async function moveItpTemplateItem(
  id: string,
  templateId: string,
  direction: 'up' | 'down'
): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: items } = await supabase
    .from('itp_template_items')
    .select('id, position')
    .eq('template_id', templateId)
    .order('position')
  if (!items || items.length === 0) return { error: 'Template has no items' }

  const idx = items.findIndex((i) => i.id === id)
  if (idx === -1) return { error: 'Item not found' }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= items.length) return {} // already at the edge

  const a = items[idx]
  const b = items[swapIdx]

  const { error: e1 } = await supabase
    .from('itp_template_items')
    .update({ position: b.position })
    .eq('id', a.id)
  if (e1) return { error: e1.message }

  const { error: e2 } = await supabase
    .from('itp_template_items')
    .update({ position: a.position })
    .eq('id', b.id)
  if (e2) return { error: e2.message }

  revalidateSettings()
  return {}
}
