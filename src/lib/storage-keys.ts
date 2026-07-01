import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared helpers for every browser-side upload surface (PhotoUpload, field
 * photo capture, documents register). Centralised so no uploader can skip
 * the sanitisation / fallbacks that keep the two-phase upload (storage
 * object first, DB row second) from failing or orphaning.
 */

export const MAX_UPLOAD_SIZE = 25 * 1024 * 1024 // 25 MB

/**
 * Makes a filename safe to embed in a Supabase Storage object key.
 * Raw names would otherwise 400 ('%', unicode) or silently truncate the
 * stored key ('#', '?'), leaving the DB row pointing at the wrong object.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Builds the canonical object key `{prefix}/{uuid}-{sanitized filename}`. */
export function buildStorageKey(prefix: string, filename: string): string {
  return `${prefix}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`
}

/**
 * Browsers report an empty MIME type for unknown extensions (.dwg, .msg, …).
 * recordAttachment's zod schema requires content_type min(1), so this
 * fallback is load-bearing — removing it would orphan the uploaded object
 * when the row insert is rejected.
 */
export function safeContentType(type: string | null | undefined): string {
  return type || 'application/octet-stream'
}

/**
 * Pre-upload guard, run BEFORE the storage upload so a validation failure
 * cannot orphan an object. Returns a user-facing error message, or null when
 * the file is acceptable. Zero-byte files are a real-world case (cloud-sync
 * placeholders, interrupted camera writes) that the server-side schema
 * (size > 0) would otherwise reject only after the object exists.
 */
export function validateUploadFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.size === 0) {
    return `${file.name} is empty — it may not have finished syncing. Skipped.`
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return `${file.name} exceeds the 25 MB limit and was skipped.`
  }
  return null
}

/**
 * Best-effort compensating delete after a failed two-phase upload (or a
 * confirmed row delete). Supabase Storage reports RLS-filtered deletes as
 * success-with-an-empty-list, so an empty result is treated as a failure and
 * logged — orphans then at least show up in logs for reconciliation.
 */
export async function removeUploadedObject(
  supabase: SupabaseClient,
  path: string,
  bucket = 'attachments'
): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(bucket).remove([path])
    if (error || !data || data.length === 0) {
      console.error(
        `Storage cleanup failed for ${bucket}/${path}:`,
        error?.message ?? 'no object removed (missing or filtered by RLS)'
      )
      return false
    }
    return true
  } catch (err) {
    console.error(
      `Storage cleanup threw for ${bucket}/${path}:`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}
