'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { subbieSwmsStatusSchema, type SubbieSwmsStatus } from '@/lib/zod'

type Result = { error?: string }

/** Legal review transitions (accepted/rejected are terminal). */
const VALID_TRANSITIONS: Record<string, SubbieSwmsStatus[]> = {
  submitted: ['under_review', 'accepted', 'rejected'],
  under_review: ['accepted', 'rejected'],
}

/**
 * Moves a subbie SWMS submission through the review flow
 * (submitted → under_review → accepted | rejected, direct accept/reject
 * allowed). Terminal transitions record reviewed_by/at (+ notes, + optional
 * vendor match); accepting also files the PDF as a project document so it
 * shows up under the project's Documents tab. Audit rows come free via the
 * subbie_swms audit trigger.
 */
export async function setSubbieSwmsStatus(
  id: string,
  data: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = subbieSwmsStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('subbie_swms')
    .select('id, status, project_id, company_name, title, file_path')
    .eq('id', id)
    .single()
  if (!existing) return { error: 'Submission not found' }

  const allowed = VALID_TRANSITIONS[existing.status as string] ?? []
  if (!allowed.includes(parsed.data.status)) {
    return {
      error: `Cannot move from ${existing.status} to ${parsed.data.status}`,
    }
  }

  const terminal =
    parsed.data.status === 'accepted' || parsed.data.status === 'rejected'

  // Accepted submissions also become a project document. COPY the object
  // (never alias the submission's path) so deleting the project document
  // later cannot destroy the SWMS register's file, then insert the
  // attachments row first so a failure leaves the review state untouched.
  let attachmentId: string | null = null
  let copiedPath: string | null = null
  if (parsed.data.status === 'accepted') {
    const destFolder = `project/${existing.project_id}`
    const destName = `${crypto.randomUUID()}-swms.pdf`
    copiedPath = `${destFolder}/${destName}`

    const { error: copyError } = await supabase.storage
      .from('attachments')
      .copy(existing.file_path, copiedPath)
    if (copyError) {
      return { error: `Could not copy the SWMS file: ${copyError.message}` }
    }

    // The submission row doesn't store the byte size — read it off the copy.
    const { data: listed } = await supabase.storage
      .from('attachments')
      .list(destFolder, { search: destName })
    const size =
      (listed?.find((o) => o.name === destName)?.metadata as
        | { size?: number }
        | undefined)?.size ?? null

    const { data: attachment, error: attachmentError } = await supabase
      .from('attachments')
      .insert({
        parent_type: 'project',
        parent_id: existing.project_id,
        bucket: 'attachments',
        path: copiedPath,
        filename: `${existing.company_name} — ${existing.title}.pdf`,
        content_type: 'application/pdf',
        size,
        kind: 'document',
        meta: { subbie_swms_id: existing.id, company: existing.company_name },
        created_by: profile.id,
      })
      .select('id')
      .single()
    if (attachmentError || !attachment) {
      await supabase.storage.from('attachments').remove([copiedPath])
      return { error: attachmentError?.message ?? 'Could not file the document' }
    }
    attachmentId = attachment.id as string
  }

  const update: Record<string, unknown> = { status: parsed.data.status }
  if (terminal) {
    update.reviewed_by = profile.id
    update.reviewed_at = new Date().toISOString()
    update.review_notes = parsed.data.notes
  }
  if (parsed.data.status === 'accepted' && parsed.data.vendor_id) {
    update.vendor_id = parsed.data.vendor_id
  }

  const { data: updated, error } = await supabase
    .from('subbie_swms')
    .update(update)
    .eq('id', id)
    .eq('status', existing.status) // guard against concurrent reviews
    .select('id')

  if (error || !updated || updated.length === 0) {
    // Roll back the document we just filed so accept stays all-or-nothing.
    // The copied object goes too — it's ours, the register's original stays.
    if (attachmentId) {
      await supabase.from('attachments').delete().eq('id', attachmentId)
    }
    if (copiedPath) {
      await supabase.storage.from('attachments').remove([copiedPath])
    }
    return {
      error:
        error?.message ?? 'Submission was already reviewed — refresh the page',
    }
  }

  revalidatePath('/whs/subbie-swms')
  revalidatePath(`/projects/${existing.project_id}/documents`)
  return {}
}
