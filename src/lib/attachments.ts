'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, getProfile } from '@/lib/auth'

// ─── Schema ──────────────────────────────────────────────────────────────────

const PARENT_TYPES = [
  'job',
  'project',
  'quote',
  'invoice',
  'claim',
  'po',
  'vendor',
  'diary',
  'variation',
  'package',
  'incident',
  'form_submission',
] as const

const KINDS = ['photo', 'docket', 'document', 'pdf'] as const

const attachmentInputSchema = z.object({
  parent_type: z.enum(PARENT_TYPES),
  parent_id: z.string().uuid(),
  path: z.string().min(1),
  filename: z.string().min(1),
  content_type: z.string().min(1),
  size: z.number().int().positive(),
  kind: z.enum(KINDS),
  caption: z.string().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional().nullable(),
})

export type AttachmentInput = z.infer<typeof attachmentInputSchema>

// ─── Actions ─────────────────────────────────────────────────────────────────

function revalidateParent(parentType: string, parentId: string) {
  // Revalidate the most common parent pages
  if (parentType === 'job') {
    revalidatePath(`/jobs/${parentId}`)
    revalidatePath('/jobs')
  } else if (parentType === 'quote') {
    revalidatePath(`/quotes/${parentId}`)
    revalidatePath('/quotes')
  } else if (parentType === 'form_submission') {
    revalidatePath(`/field/safety/submission/${parentId}`)
  } else if (parentType === 'incident') {
    revalidatePath(`/field/safety/incident/${parentId}`)
  } else {
    revalidatePath(`/${parentType}s/${parentId}`)
  }
}

/**
 * Records a new attachment row after the file has been uploaded to storage.
 * Sets created_by to the currently signed-in user.
 */
export async function recordAttachment(
  input: unknown
): Promise<{ id?: string; error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated' }

  const parsed = attachmentInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      parent_type: parsed.data.parent_type,
      parent_id: parsed.data.parent_id,
      bucket: 'attachments',
      path: parsed.data.path,
      filename: parsed.data.filename,
      content_type: parsed.data.content_type,
      size: parsed.data.size,
      kind: parsed.data.kind,
      caption: parsed.data.caption ?? null,
      meta: parsed.data.meta ?? null,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateParent(parsed.data.parent_type, parsed.data.parent_id)

  return { id: data.id }
}

/**
 * Deletes an attachment row and its backing storage object.
 * Allowed when: role is admin/office OR the caller created the attachment.
 */
export async function deleteAttachment(
  id: string
): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated' }

  const supabase = await createClient()

  // Fetch the row first so we can check ownership and get the storage path
  const { data: row, error: fetchError } = await supabase
    .from('attachments')
    .select('id, bucket, path, created_by, parent_type, parent_id')
    .eq('id', id)
    .single()

  if (fetchError || !row) return { error: 'Attachment not found' }

  const isStaff = profile.role === 'admin' || profile.role === 'office'
  const isOwner = row.created_by === profile.id

  if (!isStaff && !isOwner) {
    return { error: 'You do not have permission to delete this attachment' }
  }

  // Remove the storage object first
  const { error: storageError } = await supabase.storage
    .from(row.bucket ?? 'attachments')
    .remove([row.path])

  if (storageError) {
    // Log but don't block row deletion — orphaned storage objects are recoverable
    console.error('Storage delete error:', storageError.message)
  }

  // Delete the row
  const { error: deleteError } = await supabase
    .from('attachments')
    .delete()
    .eq('id', id)

  if (deleteError) return { error: deleteError.message }

  revalidateParent(row.parent_type, row.parent_id)

  return {}
}
