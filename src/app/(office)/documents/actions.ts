'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { versionOrdinal } from '@/lib/document-queries'
import { documentSchema, documentUpdateSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateDocuments() {
  revalidatePath('/documents')
  revalidatePath('/whs') // overview "needs attention" — overdue reviews
  revalidatePath('/field/safety') // field "Safety documents" listing
}

/**
 * Records a controlled document after the browser client has uploaded the
 * file (if any) to attachments/documents/. A document always starts life as a
 * 'draft' — the approval lifecycle (submit → approve → issue) takes it live.
 *
 * When `supersedes_id` is set this is a "new version": the old (issued) row is
 * flipped to 'superseded' first, then the new draft is inserted (revert the
 * flip if the insert fails — office users cannot delete rows, so supersede-first
 * keeps the rollback within their RLS rights). Audit rows come free via the
 * documents audit trigger.
 */
export async function createDocument(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = documentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  if (parsed.data.supersedes_id) {
    const { data: superseded, error: supersedeError } = await supabase
      .from('documents')
      .update({ status: 'superseded' })
      .eq('id', parsed.data.supersedes_id)
      .eq('status', 'issued') // only the live (issued) version can be superseded
      .select('id')
    if (supersedeError) return { error: supersedeError.message }
    if (!superseded || superseded.length === 0) {
      return { error: 'Document is no longer issued — refresh and try again' }
    }
  }

  const { error } = await supabase.from('documents').insert({
    title: parsed.data.title,
    category: parsed.data.category,
    system: parsed.data.system,
    doc_number: parsed.data.doc_number,
    version: parsed.data.version,
    status: 'draft',
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
        .from('documents')
        .update({ status: 'issued' })
        .eq('id', parsed.data.supersedes_id)
        .eq('status', 'superseded')
    }
    return { error: error.message }
  }

  revalidateDocuments()
  return {}
}

/** Metadata-only edit (title / category / system / doc number / version / review / notes). */
export async function updateDocument(id: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = documentUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('documents')
    .update(parsed.data)
    .eq('id', id)
    // Controlled metadata is frozen once issued — mirror attachDocumentFile's
    // precondition rather than relying on the UI hiding the Edit action.
    .in('status', ['draft', 'in_review', 'approved'])
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Document cannot be changed once issued' }
  }

  revalidateDocuments()
  return {}
}

/**
 * Attaches a file to an existing (draft/in_review/approved) document after the
 * browser client has uploaded it to attachments/documents/. Used to add the
 * file before issuing a draft that was created without one.
 */
export async function attachDocumentFile(
  id: string,
  file: { file_path: string; filename: string; content_type: string | null; size: number | null }
): Promise<Result> {
  await requireRole('admin', 'office')

  if (!/^documents\//.test(file.file_path) || file.file_path.includes('..')) {
    return { error: 'Invalid file path' }
  }

  const supabase = await createClient()

  // Remember the current file so a replacement doesn't orphan it.
  const { data: current } = await supabase
    .from('documents')
    .select('file_path')
    .eq('id', id)
    .single()

  const { data: updated, error } = await supabase
    .from('documents')
    .update({
      file_path: file.file_path,
      filename: file.filename,
      content_type: file.content_type,
      size: file.size,
    })
    .eq('id', id)
    .in('status', ['draft', 'in_review', 'approved'])
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Document cannot be changed once issued' }
  }

  // Best-effort cleanup of the replaced object (same pattern as deleteDocument).
  const oldPath = current?.file_path as string | null
  if (oldPath && oldPath !== file.file_path) {
    const { error: storageError } = await supabase.storage
      .from('attachments')
      .remove([oldPath])
    if (storageError) console.error('Storage delete error:', storageError.message)
  }

  revalidateDocuments()
  return {}
}

// ─── Approval lifecycle ───────────────────────────────────────────────────────

/** draft → in_review */
export async function submitForReview(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'in_review' })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Document is not a draft — refresh the page' }
  revalidateDocuments()
  return {}
}

/** in_review → approved (records approver + time) */
export async function approveDocument(id: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documents')
    .update({
      status: 'approved',
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_review')
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Document is not in review — refresh the page' }
  revalidateDocuments()
  return {}
}

/**
 * approved → issued (records issued time). GUARD: a document with no file
 * cannot be issued — the controlled register must hold the actual document.
 */
export async function issueDocument(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, status, file_path')
    .eq('id', id)
    .single()
  if (!doc) return { error: 'Document not found' }
  if (doc.status !== 'approved') return { error: 'Document is not approved — refresh the page' }
  if (!doc.file_path) return { error: 'Upload the document file before issuing' }

  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'issued', issued_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'approved')
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Document is not approved — refresh the page' }
  revalidateDocuments()
  return {}
}

/** Retires an issued document (kept on the register, leaves the field app). */
export async function archiveDocument(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'archived' })
    .eq('id', id)
    .in('status', ['issued', 'approved'])
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Document cannot be archived from its current state' }
  revalidateDocuments()
  return {}
}

/** Manually supersede an issued document without a replacement version. */
export async function supersedeDocument(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documents')
    .update({ status: 'superseded' })
    .eq('id', id)
    .eq('status', 'issued')
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Document is not issued — refresh the page' }
  revalidateDocuments()
  return {}
}

/**
 * Admin-only hard delete: clears any supersedes references pointing at the
 * row, deletes the row (acknowledgements cascade), then removes the storage
 * object if any (best-effort — an orphaned object is recoverable, a dangling
 * row is not).
 */
export async function deleteDocument(id: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('documents')
    .select('id, file_path')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Document not found' }

  const { error: detachError } = await supabase
    .from('documents')
    .update({ supersedes_id: null })
    .eq('supersedes_id', id)
  if (detachError) return { error: detachError.message }

  const { error: deleteError } = await supabase.from('documents').delete().eq('id', id)
  if (deleteError) return { error: deleteError.message }

  if (row.file_path) {
    const { error: storageError } = await supabase.storage
      .from('attachments')
      .remove([row.file_path as string])
    if (storageError) console.error('Storage delete error:', storageError.message)
  }

  revalidateDocuments()
  return {}
}

// ─── Read acknowledgement ─────────────────────────────────────────────────────

/**
 * The signed-in user acknowledges they have read the CURRENT version of an
 * issued document. Each issued version is its own `documents` row, and the
 * acknowledgement stores `document_id` pointing at that exact row — so the row
 * identity is a stable, un-spoofable key. Matching (see fetchAckRegister) is by
 * `document_id` alone, robust to a superseded predecessor being deleted.
 *
 * The stored `version` ordinal is DERIVED SERVER-SIDE from the supersedes chain
 * (never the client value) and is informational only. A second acknowledgement
 * for the same (document, user) is rejected by the unique index and reported as
 * already-acknowledged. The client-supplied argument is ignored.
 */
export async function acknowledgeDocument(documentId: string): Promise<Result> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not signed in' }

  const supabase = await createClient()

  // Only issued documents are acknowledgeable.
  const { data: doc } = await supabase
    .from('documents')
    .select('id, status')
    .eq('id', documentId)
    .single()
  if (!doc) return { error: 'Document not found' }
  if (doc.status !== 'issued') return { error: 'Only issued documents can be acknowledged' }

  // Derive the informational version ordinal server-side (chain depth), never
  // trusting the client. Load the supersedes graph and walk predecessors.
  const { data: chain } = await supabase
    .from('documents')
    .select('id, supersedes_id')
    .not('supersedes_id', 'is', null)
  const supersedesById = new Map<string, string | null>(
    (chain ?? []).map((d) => [d.id as string, (d.supersedes_id as string | null) ?? null])
  )
  const version = versionOrdinal(documentId, supersedesById)

  const { error } = await supabase.from('document_acknowledgements').insert({
    document_id: documentId,
    version,
    user_id: profile.id,
    name: profile.full_name,
  })

  if (error) {
    if (error.code === '23505') return { error: 'You have already acknowledged this version' }
    return { error: error.message }
  }

  revalidateDocuments()
  return {}
}
