'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { buildHandoverPack } from '@/pdf/build-handover-pdf'
import { HANDOVER_PACK_CAPTION, type HandoverKind } from '@/lib/feedback'

/**
 * Generates the Handover Pack PDF for a COMPLETED job/closed project and
 * stores it as an ATTACHMENT on the work (kind 'pdf', caption
 * 'Handover pack'). It lands with client_visible = FALSE — the house rule
 * (CP1): nothing reaches the portal until office explicitly flips the
 * eye-toggle on the attachment. Once visible, the portal's works history
 * shows a dedicated "Handover pack" download through the logged file gate.
 *
 * Regenerating creates a new attachment (packs are point-in-time records);
 * delete superseded ones through the normal attachment delete.
 */
export async function generateHandoverPack(
  kind: HandoverKind,
  id: string
): Promise<{ error?: string; attachmentId?: string; filename?: string }> {
  const profile = await requireRole('admin', 'office')

  if (kind !== 'job' && kind !== 'project') return { error: 'Unknown work kind' }

  const supabase = await createClient()

  const result = await buildHandoverPack(supabase, kind, id)
  if (!result.ok) return { error: result.error }

  // Point-in-time filename so regenerated packs never collide in storage.
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 13)
  const path = `${kind}/${id}/handover-pack-${result.number}-${stamp}.pdf`

  const { error: uploadError } = await supabase.storage
    .from('attachments')
    .upload(path, result.buffer, { contentType: 'application/pdf' })
  if (uploadError) {
    return { error: `Could not store the pack: ${uploadError.message}` }
  }

  const { data: row, error: insertError } = await supabase
    .from('attachments')
    .insert({
      parent_type: kind,
      parent_id: id,
      bucket: 'attachments',
      path,
      filename: result.filename,
      content_type: 'application/pdf',
      size: result.buffer.byteLength,
      kind: 'pdf',
      caption: HANDOVER_PACK_CAPTION,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (insertError || !row) {
    // Best effort cleanup of the orphaned blob.
    await supabase.storage.from('attachments').remove([path])
    return { error: insertError?.message ?? 'Could not record the pack' }
  }

  if (kind === 'job') {
    revalidatePath(`/jobs/${id}`)
  } else {
    revalidatePath(`/projects/${id}/documents`)
    revalidatePath(`/projects/${id}`)
  }
  return { attachmentId: row.id as string, filename: result.filename }
}
