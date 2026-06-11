'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { costFromDocketSchema } from '@/lib/zod'

type Result = { error?: string }

/**
 * Creates a cost row from a docket attachment, then links the cost back to the
 * attachment via attachment.meta.cost_id so the "Create cost" button is hidden
 * for already-linked dockets.
 */
export async function createCostFromDocket(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = costFromDocketSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const {
    attachment_id,
    parent_type,
    parent_id,
    date,
    description,
    amount,
    cost_code_id,
  } = parsed.data

  const supabase = await createClient()

  // Verify the attachment exists and belongs to this parent
  const { data: attachment, error: fetchError } = await supabase
    .from('attachments')
    .select('id, meta, parent_type, parent_id')
    .eq('id', attachment_id)
    .eq('parent_type', parent_type)
    .eq('parent_id', parent_id)
    .single()

  if (fetchError || !attachment) {
    return { error: 'Docket attachment not found' }
  }

  // Prevent double-linking
  const existingMeta = attachment.meta as Record<string, unknown> | null
  if (existingMeta?.cost_id) {
    return { error: 'A cost has already been created from this docket' }
  }

  // Insert the cost row
  const { data: costRow, error: costError } = await supabase
    .from('costs')
    .insert({
      parent_type,
      parent_id,
      date,
      description,
      amount,
      cost_code_id,
      source: 'docket',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (costError || !costRow) {
    return { error: costError?.message ?? 'Failed to create cost' }
  }

  // Link cost_id back into attachment.meta
  const updatedMeta = { ...(existingMeta ?? {}), cost_id: costRow.id }
  const { error: metaError } = await supabase
    .from('attachments')
    .update({ meta: updatedMeta })
    .eq('id', attachment_id)

  if (metaError) {
    // Cost was created — log but don't roll back; meta linkage is cosmetic
    console.error('Failed to link cost_id to attachment meta:', metaError.message)
  }

  // Revalidate parent
  if (parent_type === 'job') {
    revalidatePath(`/jobs/${parent_id}`)
  } else {
    revalidatePath(`/projects/${parent_id}`)
    revalidatePath(`/projects/${parent_id}/documents`)
    revalidatePath(`/projects/${parent_id}/budget`)
  }

  return {}
}
