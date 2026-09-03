'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * The per-work "Share with client" switch. ON: the work's photos, documents
 * and PDFs (incl. the close-out pack; for projects also diary photos) become
 * client_visible and new uploads default visible. OFF: all of them hide
 * again. Dockets never share. The per-attachment eye toggle still wins
 * afterwards — this only sets the starting state.
 */
export async function setWorkClientShared(
  kind: 'job' | 'project',
  id: string,
  shared: boolean
): Promise<{ error?: string; photos?: number; documents?: number }> {
  await requireRole('admin', 'office')
  if (kind !== 'job' && kind !== 'project') return { error: 'Unknown work kind' }

  const supabase = await createClient()
  const table = kind === 'job' ? 'jobs' : 'projects'

  const { data: work, error: workError } = await supabase
    .from(table)
    .update({ client_shared: shared })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (workError) return { error: workError.message }
  if (!work) return { error: 'Work not found' }

  // Diary photos belong to the project through diaries.project_id.
  let diaryIds: string[] = []
  if (kind === 'project') {
    const { data: diaries } = await supabase.from('diaries').select('id').eq('project_id', id)
    diaryIds = (diaries ?? []).map((d) => d.id as string)
  }

  const shareable = ['photo', 'document', 'pdf']
  const { data: own } = await supabase
    .from('attachments')
    .select('id, kind')
    .eq('parent_type', kind)
    .eq('parent_id', id)
    .in('kind', shareable)
  const { data: diary } =
    diaryIds.length > 0
      ? await supabase
          .from('attachments')
          .select('id, kind')
          .eq('parent_type', 'diary')
          .in('parent_id', diaryIds)
          .in('kind', shareable)
      : { data: [] as { id: string; kind: string }[] }

  const rows = [...(own ?? []), ...(diary ?? [])]
  if (rows.length > 0) {
    const { error } = await supabase
      .from('attachments')
      .update({ client_visible: shared })
      .in(
        'id',
        rows.map((r) => r.id as string)
      )
    if (error) return { error: error.message }
  }

  revalidatePath(`/${table}/${id}`)
  if (kind === 'project') {
    revalidatePath(`/projects/${id}/documents`)
    revalidatePath(`/projects/${id}/diary`)
  }

  return {
    photos: rows.filter((r) => r.kind === 'photo').length,
    documents: rows.filter((r) => r.kind !== 'photo').length,
  }
}
