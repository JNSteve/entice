'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  holdPointReleaseSchema,
  holdPointSchema,
  programmePredecessorsSchema,
  programmeTaskSchema,
  programmeTaskUpdateSchema,
} from '@/lib/zod'
import { computeAutoShifts, detectCycle } from '@/lib/programme-logic'

type Result = { error?: string }

function revalidateProgramme(projectId: string) {
  revalidatePath(`/projects/${projectId}/programme`)
  revalidatePath(`/projects/${projectId}`)
}

type Db = Awaited<ReturnType<typeof createClient>>

/**
 * Applies the finish-to-start auto-shift cascade after `changedTaskId`'s dates
 * changed: every linked successor that now overlaps its predecessor is pushed
 * forward (duration preserved). Returns the number of tasks shifted.
 */
async function autoShiftSuccessors(
  supabase: Db,
  projectId: string,
  changedTaskId: string
): Promise<{ shifted: number; error?: string }> {
  const [{ data: tasks }, { data: links }] = await Promise.all([
    supabase
      .from('programme_tasks')
      .select('id, start_date, end_date')
      .eq('project_id', projectId),
    supabase
      .from('programme_links')
      .select('predecessor_id, successor_id')
      .eq('project_id', projectId),
  ])

  const shifts = computeAutoShifts(tasks ?? [], links ?? [], changedTaskId)
  for (const s of shifts) {
    const { error } = await supabase
      .from('programme_tasks')
      .update({ start_date: s.newStart, end_date: s.newEnd })
      .eq('id', s.id)
      .eq('project_id', projectId)
    if (error) return { shifted: 0, error: error.message }
  }
  return { shifted: shifts.length }
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
): Promise<{ error?: string; shifted?: number }> {
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

  // Cascade: push linked successors forward so none overlaps its predecessor.
  const shift = await autoShiftSuccessors(supabase, projectId, taskId)
  if (shift.error) return { error: shift.error }

  revalidateProgramme(projectId)
  return { shifted: shift.shifted }
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

/**
 * Replaces the full predecessor set for one task. Rejects any combination
 * that would make the dependency graph cyclic, then re-runs the auto-shift
 * cascade so a newly-linked successor can't sit before its predecessor.
 */
export async function setTaskPredecessors(
  taskId: string,
  projectId: string,
  predecessorIds: string[]
): Promise<{ error?: string; shifted?: number }> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = programmePredecessorsSchema.safeParse({
    task_id: taskId,
    project_id: projectId,
    predecessor_ids: predecessorIds,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const ids = [...new Set(parsed.data.predecessor_ids)]
  if (ids.includes(taskId)) {
    return { error: 'A task cannot depend on itself' }
  }

  const supabase = await createClient()

  const [{ data: tasks }, { data: links }] = await Promise.all([
    supabase.from('programme_tasks').select('id').eq('project_id', projectId),
    supabase
      .from('programme_links')
      .select('predecessor_id, successor_id')
      .eq('project_id', projectId),
  ])

  const taskIds = new Set((tasks ?? []).map((t) => t.id as string))
  if (!taskIds.has(taskId)) return { error: 'Task not found' }
  if (ids.some((id) => !taskIds.has(id))) {
    return { error: 'Predecessor must be a task on this project' }
  }

  // Validate the proposed graph: existing links minus this task's current
  // predecessors, plus the new set.
  const proposed = [
    ...(links ?? []).filter((l) => l.successor_id !== taskId),
    ...ids.map((id) => ({ predecessor_id: id, successor_id: taskId })),
  ]
  if (detectCycle(proposed)) {
    return { error: 'That dependency would create a circular dependency' }
  }

  const { error: delError } = await supabase
    .from('programme_links')
    .delete()
    .eq('project_id', projectId)
    .eq('successor_id', taskId)
  if (delError) return { error: delError.message }

  if (ids.length > 0) {
    const { error: insError } = await supabase.from('programme_links').insert(
      ids.map((id) => ({
        project_id: projectId,
        predecessor_id: id,
        successor_id: taskId,
      }))
    )
    if (insError) return { error: insError.message }
  }

  // New links may already be violated (successor starts before predecessor
  // ends) — fix the successor side immediately. Shifting this task may in
  // turn cascade to its own successors.
  let shifted = 0
  for (const predId of ids) {
    const shift = await autoShiftSuccessors(supabase, projectId, predId)
    if (shift.error) return { error: shift.error }
    shifted += shift.shifted
  }

  revalidateProgramme(projectId)
  return { shifted }
}

// ─── Baseline ─────────────────────────────────────────────────────────────────

/** Copies every task's current dates into its baseline (admin/office only). */
export async function setBaseline(projectId: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: tasks, error: fetchError } = await supabase
    .from('programme_tasks')
    .select('id, start_date, end_date')
    .eq('project_id', projectId)
  if (fetchError) return { error: fetchError.message }
  if (!tasks || tasks.length === 0) return { error: 'No tasks to baseline' }

  for (const t of tasks) {
    const { error } = await supabase
      .from('programme_tasks')
      .update({ baseline_start: t.start_date, baseline_end: t.end_date })
      .eq('id', t.id)
    if (error) return { error: error.message }
  }

  revalidateProgramme(projectId)
  return {}
}

// ─── Hold points ──────────────────────────────────────────────────────────────

export async function upsertHoldPoint(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = holdPointSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: task } = await supabase
    .from('programme_tasks')
    .select('id')
    .eq('id', parsed.data.task_id)
    .eq('project_id', parsed.data.project_id)
    .single()
  if (!task) return { error: 'Task not found on this project' }

  const fields = {
    task_id: parsed.data.task_id,
    title: parsed.data.title,
    required_by: parsed.data.required_by,
    date: parsed.data.date,
    notes: parsed.data.notes ?? null,
  }

  if (parsed.data.id) {
    const { error } = await supabase
      .from('hold_points')
      .update(fields)
      .eq('id', parsed.data.id)
      .eq('project_id', parsed.data.project_id)
    if (error) return { error: error.message }
    revalidateProgramme(parsed.data.project_id)
    return { id: parsed.data.id }
  }

  const { data: row, error } = await supabase
    .from('hold_points')
    .insert({ ...fields, project_id: parsed.data.project_id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateProgramme(parsed.data.project_id)
  return { id: row.id }
}

/**
 * Status transitions: pending → notified → released, with a direct
 * pending → released shortcut. Released is terminal — only an admin may
 * reopen it (back to notified).
 */
export async function setHoldPointStatus(
  holdPointId: string,
  projectId: string,
  action: 'notify' | 'release' | 'reopen',
  release?: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { data: hp } = await supabase
    .from('hold_points')
    .select('id, status, notified_at')
    .eq('id', holdPointId)
    .eq('project_id', projectId)
    .single()
  if (!hp) return { error: 'Hold point not found' }

  let update: Record<string, unknown>

  if (action === 'notify') {
    if (hp.status !== 'pending') {
      return { error: 'Only a pending hold point can be marked notified' }
    }
    update = { status: 'notified', notified_at: new Date().toISOString() }
  } else if (action === 'release') {
    if (hp.status === 'released') {
      return { error: 'Hold point is already released' }
    }
    const parsed = holdPointReleaseSchema.safeParse(release)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid release details' }
    }
    update = {
      status: 'released',
      released_at: new Date().toISOString(),
      released_by: parsed.data.released_by,
      release_ref: parsed.data.release_ref ?? null,
    }
  } else {
    if (profile.role !== 'admin') {
      return { error: 'Only an admin can reopen a released hold point' }
    }
    if (hp.status !== 'released') {
      return { error: 'Only a released hold point can be reopened' }
    }
    update = {
      status: 'notified',
      // Released-from-pending rows have no notified_at yet — stamp it now.
      notified_at: hp.notified_at ?? new Date().toISOString(),
      released_at: null,
      released_by: null,
      release_ref: null,
    }
  }

  const { error } = await supabase
    .from('hold_points')
    .update(update)
    .eq('id', holdPointId)

  if (error) return { error: error.message }

  revalidateProgramme(projectId)
  return {}
}

export async function deleteHoldPoint(
  holdPointId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { error } = await supabase
    .from('hold_points')
    .delete()
    .eq('id', holdPointId)
    .eq('project_id', projectId)

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
