import type { SupabaseClient } from '@supabase/supabase-js'

export interface AttachmentRow {
  id: string
  parent_type: string
  parent_id: string
  bucket: string
  path: string
  filename: string
  /** Nullable in the DB (e.g. rows filed by server flows) — treat as optional. */
  content_type: string | null
  size: number | null
  kind: 'photo' | 'docket' | 'document' | 'pdf'
  caption: string | null
  meta: Record<string, unknown> | null
  created_by: string
  created_at: string
  created_by_name: string | null
  signedUrl: string | null
}

/**
 * Fetches all attachment rows for a parent and batch-generates signed URLs.
 * Use in Server Components / server-side helpers only.
 */
export async function fetchAttachmentsWithUrls(
  supabase: SupabaseClient,
  parentType: string,
  parentId: string
): Promise<AttachmentRow[]> {
  const { data: rows, error } = await supabase
    .from('attachments')
    .select(
      'id, parent_type, parent_id, bucket, path, filename, content_type, size, kind, caption, meta, created_by, created_at, profiles!attachments_created_by_fkey(full_name)'
    )
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })

  if (error || !rows || rows.length === 0) return []

  // Batch signed URLs — all paths are in the same bucket
  const paths = rows.map((r) => r.path)
  const { data: signedData } = await supabase.storage
    .from('attachments')
    .createSignedUrls(paths, 3600)

  // Build a quick lookup: path → signedUrl
  const urlMap = new Map<string, string>()
  if (signedData) {
    for (const entry of signedData) {
      if (entry.signedUrl && entry.path) {
        urlMap.set(entry.path, entry.signedUrl)
      }
    }
  }

  return rows.map((r) => {
    const profileRel = r.profiles as unknown as { full_name: string } | null
    return {
      id: r.id,
      parent_type: r.parent_type,
      parent_id: r.parent_id,
      bucket: r.bucket ?? 'attachments',
      path: r.path,
      filename: r.filename,
      content_type: r.content_type,
      size: r.size,
      kind: r.kind as AttachmentRow['kind'],
      caption: r.caption ?? null,
      meta: r.meta ?? null,
      created_by: r.created_by,
      created_at: r.created_at,
      created_by_name: profileRel?.full_name ?? null,
      signedUrl: urlMap.get(r.path) ?? null,
    }
  })
}
