'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { approveTimesheetEntry } from '@/app/(office)/reports/actions'
import {
  isIsoDate,
  isWorkKind,
  timeOfDayAU,
  timesToInstants,
  usageLineSchema,
  usageRowFields,
  type DayRef,
  type WorkKind,
} from '@/lib/site-days'

/**
 * Office corrections to what the crew recorded on one job on one day.
 * Admin, office and supervisor. Hours and quantities only.
 */

type Result = { error?: string }
type Supabase = Awaited<ReturnType<typeof createClient>>

const ID = z.guid()
const LOCKED = 'This day has a sign-off — change the figures there'

const parentColumn = (kind: WorkKind) => (kind === 'job' ? 'job_id' : 'project_id')

function parseRef(ref: DayRef): DayRef | null {
  if (!ref || typeof ref !== 'object') return null
  if (!isWorkKind(String(ref.kind))) return null
  if (!ID.safeParse(ref.workId).success) return null
  if (typeof ref.date !== 'string' || !isIsoDate(ref.date)) return null
  return { kind: ref.kind, workId: ref.workId, date: ref.date }
}

function revalidateDay(ref: DayRef) {
  revalidatePath('/site-days')
  revalidatePath(`/site-days/${ref.kind}/${ref.workId}/${ref.date}`)
  revalidatePath('/reports')
  revalidatePath(ref.kind === 'job' ? `/jobs/${ref.workId}` : `/projects/${ref.workId}/site-days`)
}

type EntryRow = { id: string; start_at: string; end_at: string | null; approved: boolean }

/** The entry, only if it belongs to this job-day. */
async function entryOnDay(supabase: Supabase, ref: DayRef, entryId: string): Promise<EntryRow | null> {
  const { data } = await supabase
    .from('timesheet_entries')
    .select('id, start_at, end_at, approved')
    .eq('id', entryId)
    .eq(parentColumn(ref.kind), ref.workId)
    .eq('date', ref.date)
    .maybeSingle()
  return (data as EntryRow | null) ?? null
}

async function dayHasSignoff(supabase: Supabase, ref: DayRef): Promise<boolean> {
  const { data } = await supabase
    .from('daily_signoffs')
    .select('id')
    .eq(parentColumn(ref.kind), ref.workId)
    .eq('date', ref.date)
    .limit(1)
  return (data ?? []).length > 0
}

// ─── Hours ───────────────────────────────────────────────────────────────────

export async function setEntryApproved(
  ref: DayRef,
  entryId: string,
  approved: boolean
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(entryId).success) return { error: 'Entry not found' }

  const supabase = await createClient()
  const entry = await entryOnDay(supabase, day, entryId)
  if (!entry) return { error: 'Entry not found' }
  if (approved && entry.end_at === null) return { error: 'Set a finish time first' }

  const result = await approveTimesheetEntry(entryId, approved === true)
  if (result.error) return result
  revalidateDay(day)
  return {}
}

export async function updateEntryTimes(
  ref: DayRef,
  entryId: string,
  start: string,
  end: string | null
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(entryId).success) return { error: 'Entry not found' }

  const times = timesToInstants(day.date, start, end)
  if ('error' in times) return { error: times.error }

  const supabase = await createClient()
  const entry = await entryOnDay(supabase, day, entryId)
  if (!entry) return { error: 'Entry not found' }
  if (entry.end_at !== null && end === null) return { error: 'Enter a finish time' }

  // Compare at minute precision so re-saving an untouched row changes nothing
  // (stored instants carry seconds; the form does not).
  const startChanged = timeOfDayAU(entry.start_at) !== start
  const endChanged = (entry.end_at === null ? null : timeOfDayAU(entry.end_at)) !== end
  if (!startChanged && !endChanged) return {}

  const patch: Record<string, unknown> = {}
  if (startChanged) patch.start_at = times.startIso
  if (endChanged) patch.end_at = times.endIso
  // Changed hours are always approved again.
  if (entry.approved) {
    patch.approved = false
    patch.approved_by = null
  }

  const { error } = await supabase.from('timesheet_entries').update(patch).eq('id', entryId)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function addTimesheetEntry(
  ref: DayRef,
  userId: string,
  start: string,
  end: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(userId).success) return { error: 'Pick a person' }

  const times = timesToInstants(day.date, start, end)
  if ('error' in times) return { error: times.error }
  if (times.endIso === null) return { error: 'Enter a finish time' }

  const supabase = await createClient()
  const col = parentColumn(day.kind)

  // Link the schedule entry when the person was scheduled here that day, so
  // the entry is not tagged Unscheduled by mistake.
  const { data: assignment } = await supabase
    .from('assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('date', day.date)
    .eq(col, day.workId)
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: userId,
    assignment_id: (assignment?.id as string | undefined) ?? null,
    [col]: day.workId,
    date: day.date,
    start_at: times.startIso,
    end_at: times.endIso,
    approved: false,
  })
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function deleteTimesheetEntry(ref: DayRef, entryId: string): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(entryId).success) return { error: 'Entry not found' }

  const supabase = await createClient()
  const entry = await entryOnDay(supabase, day, entryId)
  if (!entry) return { error: 'Entry not found' }

  const { error } = await supabase.from('timesheet_entries').delete().eq('id', entryId)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

/** Approve every closed entry on this job for this day. */
export async function approveDay(ref: DayRef): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('timesheet_entries')
    .update({ approved: true, approved_by: profile.id })
    .eq(parentColumn(day.kind), day.workId)
    .eq('date', day.date)
    .eq('approved', false)
    .not('end_at', 'is', null)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

// ─── Materials, plant and subbies ────────────────────────────────────────────

export async function addUsageLine(ref: DayRef, input: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  const parsed = usageLineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid line' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const { error } = await supabase.from('field_usage').insert({
    [parentColumn(day.kind)]: day.workId,
    date: day.date,
    user_id: profile.id,
    ...usageRowFields(parsed.data),
  })
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function updateUsageLine(ref: DayRef, lineId: string, input: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(lineId).success) return { error: 'Line not found' }
  const parsed = usageLineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid line' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const { data: line } = await supabase
    .from('field_usage')
    .select('id, kind')
    .eq('id', lineId)
    .eq(parentColumn(day.kind), day.workId)
    .eq('date', day.date)
    .maybeSingle()
  if (!line) return { error: 'Line not found' }
  if (line.kind !== parsed.data.kind) return { error: 'A line cannot change type — delete it and add a new one' }

  const { error } = await supabase
    .from('field_usage')
    .update(usageRowFields(parsed.data))
    .eq('id', lineId)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function deleteUsageLine(ref: DayRef, lineId: string): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(lineId).success) return { error: 'Line not found' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const { data, error } = await supabase
    .from('field_usage')
    .delete()
    .eq('id', lineId)
    .eq(parentColumn(day.kind), day.workId)
    .eq('date', day.date)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Line not found' }
  revalidateDay(day)
  return {}
}

const summarySchema = z.string().max(4000, 'Keep it under 4000 characters')

export async function saveWorkSummary(ref: DayRef, summary: string): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  const parsed = summarySchema.safeParse(summary)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid summary' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const col = parentColumn(day.kind)
  const { error } = await supabase.from('field_day_notes').upsert(
    {
      [col]: day.workId,
      date: day.date,
      summary: parsed.data.trim(),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: `${col},date` }
  )
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}
