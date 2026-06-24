'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { diarySchema } from '@/lib/zod'

type Result = { error?: string; id?: string }

/** YYYY-MM-DD for today (server local). */
function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Office/admin/supervisor diary upsert. Unlike the field flow (today/yesterday
 * only), back-entry is allowed for ANY past date — future dates are rejected.
 * Mirrors the field saveDiary upsert logic and returns the diary row id so the
 * client can immediately manage child rows and photos.
 */
export async function saveProjectDiary(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = diarySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const { project_id, date, weather, work_performed, delays, instructions, visitors } =
    parsed.data

  if (date > todayStr()) {
    return { error: 'Diary date cannot be in the future.' }
  }

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
    .eq('id', project_id)
    .single()
  if (!project) return { error: 'Project not found' }
  if (project.status === 'closed') {
    return { error: 'This project is closed — diary entries are no longer accepted.' }
  }

  const fields = {
    weather: weather ?? null,
    work_performed,
    delays: delays ?? null,
    instructions: instructions ?? null,
    visitors: visitors ?? null,
  }

  const { data: existing } = await supabase
    .from('diaries')
    .select('id')
    .eq('project_id', project_id)
    .eq('date', date)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('diaries')
      .update(fields)
      .eq('id', existing.id)
    if (error) return { error: error.message }
    revalidateDiary(project_id)
    return { id: existing.id }
  }

  const { data: inserted, error } = await supabase
    .from('diaries')
    .insert({
      project_id,
      date,
      ...fields,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) {
    // Race on unique(project_id, date): another save created the row first —
    // fall through to the update path (last write wins).
    if (error.code === '23505') {
      const { data: raced, error: updateError } = await supabase
        .from('diaries')
        .update(fields)
        .eq('project_id', project_id)
        .eq('date', date)
        .select('id')
        .single()
      if (updateError) return { error: updateError.message }
      revalidateDiary(project_id)
      return { id: raced?.id }
    }
    return { error: error.message }
  }

  revalidateDiary(project_id)
  return { id: inserted?.id }
}

function revalidateDiary(projectId: string) {
  revalidatePath(`/projects/${projectId}/diary`)
  revalidatePath(`/field/diary/${projectId}`)
}

// NOTE: the child-row actions (addLabourRow, updateLabourRow, deleteLabourRow,
// addPlantRow, deletePlantRow) are reused directly from
// '@/app/field/diary/[projectId]/actions' by the client component. A 'use server'
// module may only export async functions — it cannot re-export them — so they
// are intentionally NOT re-exported here.
