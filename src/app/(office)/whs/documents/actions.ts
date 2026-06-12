'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { whsDocumentSchema, whsDocumentUpdateSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateDocuments() {
  revalidatePath('/whs/documents')
  revalidatePath('/whs') // overview "needs attention" — overdue reviews
  revalidatePath('/field/safety') // field "Safety documents" listing
}

/**
 * Records a WHS library document after the browser client has uploaded the
 * file to attachments/whs-documents/. When `supersedes_id` is set this is a
 * "new version": the old row is flipped to 'superseded' first, then the new
 * row is inserted (revert the flip if the insert fails — office users cannot
 * delete rows, so supersede-first keeps the rollback within their RLS rights).
 * Audit rows come free via the whs_documents audit trigger.
 */
export async function createWhsDocument(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = whsDocumentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  if (parsed.data.supersedes_id) {
    const { data: superseded, error: supersedeError } = await supabase
      .from('whs_documents')
      .update({ status: 'superseded' })
      .eq('id', parsed.data.supersedes_id)
      .eq('status', 'current') // only current docs can be superseded
      .select('id')
    if (supersedeError) return { error: supersedeError.message }
    if (!superseded || superseded.length === 0) {
      return {
        error: 'Document is no longer current — refresh and try again',
      }
    }
  }

  const { error } = await supabase.from('whs_documents').insert({
    title: parsed.data.title,
    category: parsed.data.category,
    doc_number: parsed.data.doc_number,
    version: parsed.data.version,
    file_path: parsed.data.file_path,
    filename: parsed.data.filename,
    content_type: parsed.data.content_type,
    size: parsed.data.size,
    review_due: parsed.data.review_due,
    notes: parsed.data.notes,
    supersedes_id: parsed.data.supersedes_id,
    uploaded_by: profile.id,
  })

  if (error) {
    // Roll back the supersede flip so versioning stays all-or-nothing.
    if (parsed.data.supersedes_id) {
      await supabase
        .from('whs_documents')
        .update({ status: 'current' })
        .eq('id', parsed.data.supersedes_id)
        .eq('status', 'superseded')
    }
    return { error: error.message }
  }

  revalidateDocuments()
  return {}
}

/** Metadata-only edit (title / category / doc number / version / review / notes). */
export async function updateWhsDocument(
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = whsDocumentUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('whs_documents')
    .update(parsed.data)
    .eq('id', id)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) return { error: 'Document not found' }

  revalidateDocuments()
  return {}
}

/** Retires a current document without replacing it (kept for the record). */
export async function archiveWhsDocument(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('whs_documents')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('status', 'current')
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Document is no longer current — refresh the page' }
  }

  revalidateDocuments()
  return {}
}

/**
 * Admin-only hard delete: clears any supersedes references pointing at the
 * row, deletes the row, then removes the storage object (best-effort — an
 * orphaned object is recoverable, a dangling row is not).
 */
export async function deleteWhsDocument(id: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('whs_documents')
    .select('id, file_path')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Document not found' }

  // Newer versions reference this row via supersedes_id — detach them first
  // so the FK does not block the delete.
  const { error: detachError } = await supabase
    .from('whs_documents')
    .update({ supersedes_id: null })
    .eq('supersedes_id', id)
  if (detachError) return { error: detachError.message }

  const { error: deleteError } = await supabase
    .from('whs_documents')
    .delete()
    .eq('id', id)
  if (deleteError) return { error: deleteError.message }

  const { error: storageError } = await supabase.storage
    .from('attachments')
    .remove([row.file_path as string])
  if (storageError) {
    console.error('Storage delete error:', storageError.message)
  }

  revalidateDocuments()
  return {}
}
