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
  /** Client-portal curation flag — false unless office explicitly shares it. */
  client_visible: boolean
  created_by: string
  created_at: string
  created_by_name: string | null
  signedUrl: string | null
}

const ATTACHMENT_SELECT =
  'id, parent_type, parent_id, bucket, path, filename, content_type, size, kind, caption, meta, client_visible, created_by, created_at, profiles!attachments_created_by_fkey(full_name)'

/** Batch-sign paths (all in the 'attachments' bucket) → path → signedUrl. */
async function signedUrlMap(
  supabase: SupabaseClient,
  paths: string[]
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>()
  if (paths.length === 0) return urlMap

  const { data: signedData } = await supabase.storage
    .from('attachments')
    .createSignedUrls(paths, 3600)

  if (signedData) {
    for (const entry of signedData) {
      if (entry.signedUrl && entry.path) {
        urlMap.set(entry.path, entry.signedUrl)
      }
    }
  }
  return urlMap
}

/** Shape a raw ATTACHMENT_SELECT row into the plain AttachmentRow object. */
function shapeRow(
  r: Record<string, unknown>,
  urlMap: Map<string, string>
): AttachmentRow {
  const profileRel = r.profiles as unknown as { full_name: string } | null
  const path = r.path as string
  return {
    id: r.id as string,
    parent_type: r.parent_type as string,
    parent_id: r.parent_id as string,
    bucket: (r.bucket as string | null) ?? 'attachments',
    path,
    filename: r.filename as string,
    content_type: (r.content_type as string | null) ?? null,
    size: (r.size as number | null) ?? null,
    kind: r.kind as AttachmentRow['kind'],
    caption: (r.caption as string | null) ?? null,
    meta: (r.meta as Record<string, unknown> | null) ?? null,
    client_visible: Boolean(r.client_visible),
    created_by: r.created_by as string,
    created_at: r.created_at as string,
    created_by_name: profileRel?.full_name ?? null,
    signedUrl: urlMap.get(path) ?? null,
  }
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
    .select(ATTACHMENT_SELECT)
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })

  if (error || !rows || rows.length === 0) return []

  // Batch signed URLs — all paths are in the same bucket
  const urlMap = await signedUrlMap(
    supabase,
    rows.map((r) => r.path as string)
  )

  return rows.map((r) => shapeRow(r as Record<string, unknown>, urlMap))
}

/**
 * Batched variant of fetchAttachmentsWithUrls for MANY parents of the same
 * type: ONE select over all parent ids and ONE batched signed-URL call across
 * all rows. Every requested parent id is present in the result (empty array
 * when it has no attachments); each list is ordered newest-first.
 */
export async function fetchAttachmentsForParents(
  supabase: SupabaseClient,
  parentType: string,
  parentIds: string[]
): Promise<Record<string, AttachmentRow[]>> {
  const byParent: Record<string, AttachmentRow[]> = {}
  for (const id of parentIds) byParent[id] = []
  if (parentIds.length === 0) return byParent

  const { data: rows, error } = await supabase
    .from('attachments')
    .select(ATTACHMENT_SELECT)
    .eq('parent_type', parentType)
    .in('parent_id', parentIds)
    .order('created_at', { ascending: false })

  if (error || !rows || rows.length === 0) return byParent

  const urlMap = await signedUrlMap(
    supabase,
    rows.map((r) => r.path as string)
  )

  for (const raw of rows) {
    const row = shapeRow(raw as Record<string, unknown>, urlMap)
    ;(byParent[row.parent_id] ??= []).push(row)
  }
  return byParent
}
