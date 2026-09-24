'use client'

import { createClient } from '@/lib/supabase/client'
import { recordAttachment } from '@/lib/attachments'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'

/**
 * Two-phase upload (storage object, then attachments row) returning the new
 * attachment id — the same flow as PhotoUpload, with compensating cleanup.
 */
export async function uploadAttachmentFile(input: {
  parentType: string
  parentId: string
  file: File
  kind: 'document'
}): Promise<{ id: string } | { error: string }> {
  const invalid = validateUploadFile(input.file)
  if (invalid) return { error: invalid }

  const supabase = createClient()
  const path = buildStorageKey(`${input.parentType}/${input.parentId}`, input.file.name)
  const contentType = safeContentType(input.file.type)

  const { error: storageError } = await supabase.storage
    .from('attachments')
    .upload(path, input.file, { contentType, upsert: false })
  if (storageError) return { error: storageError.message }

  try {
    const result = await recordAttachment({
      parent_type: input.parentType,
      parent_id: input.parentId,
      path,
      filename: input.file.name,
      content_type: contentType,
      size: input.file.size,
      kind: input.kind,
      caption: null,
      meta: null,
    })
    if (result.error || !result.id) {
      await removeUploadedObject(supabase, path)
      return { error: result.error ?? 'Could not save the file' }
    }
    return { id: result.id }
  } catch (err) {
    await removeUploadedObject(supabase, path)
    return { error: err instanceof Error ? err.message : 'Upload failed' }
  }
}
