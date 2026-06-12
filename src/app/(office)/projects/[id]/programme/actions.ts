'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { programmeTaskSchema, programmeTaskUpdateSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateProgramme(projectId: string) {
  revalidatePath(`/projects/${projectId}/programme`)
  revalidatePath(`/projects/${projectId}`)
}

// ─── Create task ──────────────────────────────────────────────────────────────

export async function createProgrammeTask(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = programmeTaskSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', parsed.data.project_id)
    .single()
  if (!project) return { error: 'Project not found' }

  // Append at the end of the project's task list.
  const { data: maxRow } = await supabase
    .from('programme_tasks')
    .select('position')
    .eq('project_id', parsed.data.project_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: row, error } = await supabase
    .from('programme_tasks')
    .insert({
      project_id: parsed.data.project_id,
      name: parsed.data.name,
      phase: parsed.data.phase ?? null,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      progress_pct: parsed.data.progress_pct,
      position: (maxRow?.position ?? 0) + 1,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateProgramme(parsed.data.project_id)
  return { id: row.id }
}

// ─── Update task (fields, drag-move, resize, progress) ───────────────────────

export async function updateProgrammeTask(
  taskId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = programmeTaskUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: task } = await supabase
    .from('programme_tasks')
    .select('id, start_date, end_date')
    .eq('id', taskId)
    .eq('project_id', projectId)
    .single()
  if (!task) return { error: 'Task not found' }

  // Cross-field date check against the stored row when only one date changes.
  const nextStart = parsed.data.start_date ?? (task.start_date as string)
  const nextEnd = parsed.data.end_date ?? (task.end_date as string)
  if (nextEnd < nextStart) {
    return { error: 'End date must be on or after the start date' }
  }

  const { error } = await supabase
    .from('programme_tasks')
    .update(parsed.data)
    .eq('id', taskId)

  if (error) return { error: error.message }

  revalidateProgramme(projectId)
  return {}
}

// ─── Delete task ──────────────────────────────────────────────────────────────

export async function deleteProgrammeTask(
  taskId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { error } = await supabase
    .from('programme_tasks')
    .delete()
    .eq('id', taskId)
    .eq('project_id', projectId)

  if (error) return { error: error.message }

  revalidateProgramme(projectId)
  return {}
}
