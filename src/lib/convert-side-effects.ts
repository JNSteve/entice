import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Post-conversion side effects. Both are BEST-EFFORT: a failed copy or seed
 * logs and returns rather than failing the conversion — the job/project row
 * is already committed and the redirect must proceed.
 */

/** Seed checklist items from every template flagged auto_apply_on_convert. */
export async function seedConvertChecklist(
  supabase: SupabaseClient,
  target:
    | { table: 'job_checklist_items'; fk: 'job_id' }
    | { table: 'project_checklist_items'; fk: 'project_id' },
  parentId: string
): Promise<void> {
  const { data: templates } = await supabase
    .from('checklist_templates')
    .select('items')
    .eq('auto_apply_on_convert', true)
    .order('title')

  const texts = (templates ?? []).flatMap((t) => (t.items as string[]) ?? [])
  if (texts.length === 0) return

  const { error } = await supabase.from(target.table).insert(
    texts.map((text, i) => ({ [target.fk]: parentId, text, position: i, done: false }))
  )
  if (error) console.error('convert: checklist seed failed —', error.message)
}

/**
 * Copy the quote's attachments (scope docs, survey PDFs) onto the converted
 * job/project. Each blob is COPIED to a new storage path — attachment rows
 * must never share a path, because deleteAttachment removes the blob.
 */
export async function copyQuoteAttachments(
  supabase: SupabaseClient,
  quoteId: string,
  parentType: 'job' | 'project',
  parentId: string,
  userId: string
): Promise<void> {
  const { data: rows } = await supabase
    .from('attachments')
    .select('bucket, path, filename, content_type, size, kind, caption, meta')
    .eq('parent_type', 'quote')
    .eq('parent_id', quoteId)

  for (const row of rows ?? []) {
    const bucket = row.bucket ?? 'attachments'
    const destPath = `${parentType}/${parentId}/${crypto.randomUUID()}`
    const { error: copyErr } = await supabase.storage.from(bucket).copy(row.path, destPath)
    if (copyErr) {
      console.error('convert: attachment blob copy failed —', row.path, copyErr.message)
      continue
    }
    const { error: insErr } = await supabase.from('attachments').insert({
      parent_type: parentType,
      parent_id: parentId,
      bucket,
      path: destPath,
      filename: row.filename,
      content_type: row.content_type,
      size: row.size,
      kind: row.kind,
      caption: row.caption ?? 'Carried over from quote',
      meta: { ...((row.meta as Record<string, unknown>) ?? {}), copied_from_quote: quoteId },
      created_by: userId,
    })
    if (insErr) console.error('convert: attachment row insert failed —', insErr.message)
  }
}
