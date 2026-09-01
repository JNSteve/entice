'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth'
import {
  ATTACHMENT_KINDS,
  PARENT_TABLE,
  PARENT_TYPES,
} from '@/lib/attachment-parents'

// ─── Schema ──────────────────────────────────────────────────────────────────

// The canonical lists live in a plain module so the agent API can share them —
// this file is 'use server' and may only export async functions. The parent
// existence lookup below runs under the caller's OWN RLS session, so a role
// that cannot see a parent row (e.g. a field user probing a money table)
// cannot attach to it either.
const KINDS = ATTACHMENT_KINDS

const attachmentInputSchema = z.object({
  parent_type: z.enum(PARENT_TYPES),
  parent_id: z.string().uuid(),
  path: z.string().min(1),
  filename: z.string().min(1),
  // Callers must send a fallback (safeContentType) for browsers that report
  // an empty MIME type — min(1) rejects '' AFTER the object is uploaded.
  content_type: z.string().min(1),
  // Clients pre-check this (validateUploadFile), so the message here is a
  // backstop for anything that slips through.
  size: z
    .number()
    .int()
    .positive('File is empty — it may not have finished syncing'),
  kind: z.enum(KINDS),
  caption: z.string().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional().nullable(),
})

export type AttachmentInput = z.infer<typeof attachmentInputSchema>

// ─── Actions ─────────────────────────────────────────────────────────────────

async function revalidateParent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  parentType: string,
  parentId: string
) {
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
  } else if (parentType === 'ncr') {
    revalidatePath(`/whs/ncr/${parentId}`)
  } else if (parentType === 'waste_load') {
    revalidatePath(`/whs/env/loads/${parentId}`)
    revalidatePath('/whs/env')
  } else if (parentType === 'regulated_waste_movement') {
    revalidatePath('/whs/env/regulated')
    revalidatePath('/field/waste/regulated')
  } else if (parentType === 'lot') {
    // Lots live under /projects/[id]/quality/lots/[lotId]
    const { data } = await supabase
      .from('lots')
      .select('project_id')
      .eq('id', parentId)
      .maybeSingle()
    if (data?.project_id) {
      revalidatePath(`/projects/${data.project_id}/quality/lots/${parentId}`)
    }
  } else if (parentType === 'variation') {
    // Variations live under their project, not at a top-level /variations
    const { data } = await supabase
      .from('variations')
      .select('project_id')
      .eq('id', parentId)
      .maybeSingle()
    if (data?.project_id) {
      revalidatePath(`/projects/${data.project_id}/variations`)
    }
  } else if (parentType === 'package') {
    // Packages live under /projects/[id]/procurement/[packageId]
    const { data } = await supabase
      .from('packages')
      .select('project_id')
      .eq('id', parentId)
      .maybeSingle()
    if (data?.project_id) {
      revalidatePath(`/projects/${data.project_id}/procurement/${parentId}`)
    }
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

  // Verify the claimed parent actually exists, under the caller's own RLS —
  // kills attachment rows pointing at made-up or invisible parent records.
  const { data: parent } = await supabase
    .from(PARENT_TABLE[parsed.data.parent_type])
    .select('id')
    .eq('id', parsed.data.parent_id)
    .maybeSingle()
  if (!parent) return { error: 'Parent record not found' }

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
      // meta is `jsonb NOT NULL DEFAULT '{}'` — an explicit null overrides the
      // default and violates the constraint, so fall back to an empty object.
      meta: parsed.data.meta ?? {},
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  await revalidateParent(supabase, parsed.data.parent_type, parsed.data.parent_id)

  return { id: data.id }
}

/**
 * Client-portal curation: flips an attachment's client_visible flag.
 * Admin/office only, and only on job/project attachments — the portal's
 * Works tab is the only surface that ever reads the flag, and NOTHING is
 * visible until explicitly toggled here.
 */
export async function setAttachmentClientVisible(
  id: string,
  visible: boolean
): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated' }
  if (profile.role !== 'admin' && profile.role !== 'office') {
    return { error: 'Only admin/office can change client visibility' }
  }

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('attachments')
    .select('id, parent_type, parent_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { error: 'Attachment not found' }
  if (row.parent_type !== 'job' && row.parent_type !== 'project') {
    return { error: 'Only job and project attachments can be shared to the portal' }
  }

  const { error } = await supabase
    .from('attachments')
    .update({ client_visible: visible })
    .eq('id', id)
  if (error) return { error: error.message }

  await revalidateParent(supabase, row.parent_type, row.parent_id)
  return {}
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

  // Delete the row FIRST (an orphaned storage object is recoverable, a row
  // pointing at a deleted object is not), then best-effort remove the object.
  const { error: deleteError } = await supabase
    .from('attachments')
    .delete()
    .eq('id', id)

  if (deleteError) return { error: deleteError.message }

  const { data: removed, error: storageError } = await supabase.storage
    .from(row.bucket ?? 'attachments')
    .remove([row.path])

  // Supabase reports RLS-filtered deletes as success-with-empty-list, so an
  // empty result means nothing was removed — log it so orphans are visible.
  if (storageError || !removed || removed.length === 0) {
    console.error(
      'Storage delete skipped/failed for',
      row.path,
      storageError?.message ?? 'no object removed (missing or filtered by RLS)'
    )
  }

  await revalidateParent(supabase, row.parent_type, row.parent_id)

  return {}
}
