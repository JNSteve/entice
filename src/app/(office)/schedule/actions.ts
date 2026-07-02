'use server'

import { revalidatePath } from 'next/cache'
import { eachDayOfInterval, parseISO } from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { competencyWarningsForProfile } from '@/lib/competency-queries'
import { todayAU } from '@/lib/tz'
import { assignmentSchema, assignmentUpdateSchema } from '@/lib/zod'

type Result = { error?: string }

// ─── Competency roster warning (ISO 7.2 — warn, never block) ─────────────────

/**
 * Mandatory competencies missing/expired/expiring for the person's role.
 * Used by the assign dialog (inline warning) and echoed from createAssignment
 * so the check cannot be bypassed silently. Best-effort: an error here must
 * never break scheduling.
 */
export async function fetchAssigneeCompetencyWarnings(
  userId: string
): Promise<{ items: string[] }> {
  await requireRole('admin', 'office', 'supervisor')
  try {
    const supabase = await createClient()
    const items = await competencyWarningsForProfile(supabase, userId, todayAU())
    return { items }
  } catch {
    return { items: [] }
  }
}

// ─── Create assignment(s) ────────────────────────────────────────────────────

/**
 * Creates one assignment, or multiple when `repeat_until` is supplied.
 * Duplicates (same user_id + date + target) are silently skipped.
 * Returns the count of rows actually inserted, plus a NON-BLOCKING competency
 * `warning` when the person lacks a current mandatory competency for their
 * role (owner decision: warn but allow — the assignment always proceeds).
 */
export async function createAssignment(
  data: unknown
): Promise<{ error?: string; created?: number; warning?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = assignmentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const { user_id, date, job_id, project_id, note, repeat_until } = parsed.data

  // Build list of dates — either just the one date, or a range
  let dates: string[] = [date]

  if (repeat_until) {
    try {
      const start = parseISO(date)
      const end = parseISO(repeat_until)
      if (end > start) {
        const all = eachDayOfInterval({ start, end })
        // Mon–Sun only (getDay: 0=Sun,1=Mon…6=Sat) — all weekdays included per spec
        const capped = all.slice(0, 14)
        dates = capped.map((d) => {
          const y = d.getFullYear()
          const m = String(d.getMonth() + 1).padStart(2, '0')
          const day = String(d.getDate()).padStart(2, '0')
          return `${y}-${m}-${day}`
        })
      }
    } catch {
      return { error: 'Invalid repeat_until date' }
    }
  }

  const supabase = await createClient()

  // Check which (user_id, date, target) combos already exist to skip dupes
  const targetCol = job_id ? 'job_id' : 'project_id'
  const targetId = job_id ?? project_id!

  const { data: existing } = await supabase
    .from('assignments')
    .select('date')
    .eq('user_id', user_id)
    .eq(targetCol, targetId)
    .in('date', dates)

  const existingDates = new Set((existing ?? []).map((r) => r.date as string))
  const toInsert = dates.filter((d) => !existingDates.has(d))

  // Competency check (warn but ALLOW): computed server-side so the dialog UI
  // cannot silently bypass it. Best-effort — never blocks the assignment.
  let warning: string | undefined
  try {
    const items = await competencyWarningsForProfile(supabase, user_id, todayAU())
    if (items.length > 0) {
      warning = `Competency warning — ${items.join('; ')}. The assignment was still created.`
    }
  } catch {
    // ignore — a warning failure must not break scheduling
  }

  if (toInsert.length === 0) return { created: 0, warning }

  const rows = toInsert.map((d) => ({
    user_id,
    date: d,
    job_id: job_id ?? null,
    project_id: project_id ?? null,
    note: note ?? null,
    created_by: profile.id,
  }))

  const { error } = await supabase.from('assignments').insert(rows)
  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return { created: rows.length, warning }
}

// ─── Update assignment ────────────────────────────────────────────────────────

export async function updateAssignment(
  assignmentId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = assignmentUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('assignments')
    .update(parsed.data)
    .eq('id', assignmentId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

// ─── Delete assignment ────────────────────────────────────────────────────────

export async function deleteAssignment(
  assignmentId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { error } = await supabase
    .from('assignments')
    .delete()
    .eq('id', assignmentId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}
