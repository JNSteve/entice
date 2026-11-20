'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { checkInSchema, manualEntrySchema } from '@/lib/zod'
import { isLiveWork, type WorkKind } from '@/lib/live-work'
import { auLocalToInstant, todayAU, yesterdayAU } from '@/lib/tz'

type Result = { error?: string }
type Work = { kind: WorkKind; id: string }

const WORK_COLUMN = { job: 'job_id', project: 'project_id' } as const

function workOf(v: { job_id: string | null; project_id: string | null }): Work {
  return v.job_id
    ? { kind: 'job', id: v.job_id }
    : { kind: 'project', id: v.project_id as string }
}

/** Refuses hours against work that is not live (quote, invoiced, closed, archived). */
async function liveWorkError(supabase: SupabaseClient, work: Work): Promise<string | null> {
  const { data } = await supabase
    .from(work.kind === 'job' ? 'jobs' : 'projects')
    .select('status, archived')
    .eq('id', work.id)
    .maybeSingle()
  if (!data) return 'That job could not be found.'
  if (!isLiveWork(work.kind, data.status as string, Boolean(data.archived))) {
    return "Hours can't be logged against that job at its current status."
  }
  return null
}

/** The person's schedule entry for this work on this day, when there is one. */
async function findAssignmentId(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  work: Work
): Promise<string | null> {
  const { data } = await supabase
    .from('assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq(WORK_COLUMN[work.kind], work.id)
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

type OpenRow = { id: string; job_id: string | null; project_id: string | null }

const READ_FAILED = "Couldn't check whether you're already checked in. Try again."

/**
 * The person's open entry (no finish time). Nothing in the database enforces
 * "one open entry", so this must not fail open: a read error is returned to
 * the caller rather than read as "not checked in", and the newest row is
 * taken if a duplicate ever exists (a bare maybeSingle() would error on two
 * rows and blind every reader).
 */
async function openEntry(
  supabase: SupabaseClient,
  userId: string
): Promise<{ entry: OpenRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('timesheet_entries')
    .select('id, job_id, project_id')
    .eq('user_id', userId)
    .is('end_at', null)
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { entry: null, error: READ_FAILED }
  return { entry: (data as OpenRow | null) ?? null, error: null }
}

/**
 * Closes every open entry the person has. Normally that is exactly one; if a
 * duplicate ever exists this heals it instead of stranding it.
 */
async function closeOpenEntries(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase
    .from('timesheet_entries')
    .update({ end_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('end_at', null)
  return error ? error.message : null
}

async function insertOpenEntry(
  supabase: SupabaseClient,
  userId: string,
  work: Work
): Promise<string | null> {
  const today = todayAU()
  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: userId,
    assignment_id: await findAssignmentId(supabase, userId, today, work),
    job_id: work.kind === 'job' ? work.id : null,
    project_id: work.kind === 'project' ? work.id : null,
    date: today,
    start_at: new Date().toISOString(),
    approved: false,
  })
  return error ? error.message : null
}

// ─── Check in ────────────────────────────────────────────────────────────────

/**
 * Opens a timesheet entry on any live job or project, scheduled or not.
 * Rejects if the person already has an open entry.
 */
export async function checkIn(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = checkInSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const work = workOf(parsed.data)

  const supabase = await createClient()
  const notLive = await liveWorkError(supabase, work)
  if (notLive) return { error: notLive }

  const open = await openEntry(supabase, profile.id)
  if (open.error) return { error: open.error }
  if (open.entry) {
    // The screen that sent this was stale (checked in from another tab or
    // device since it rendered) — refresh it so it offers Switch / Check out.
    revalidatePath('/field', 'layout')
    return { error: 'You are already checked in. Check out first.' }
  }

  const failed = await insertOpenEntry(supabase, profile.id, work)
  if (failed) return { error: failed }

  revalidatePath('/field', 'layout')
  return {}
}

// ─── Switch job ──────────────────────────────────────────────────────────────

/**
 * Checks out of the current job (if any) and into this one. The two writes
 * are not one transaction: if the second fails the person is left checked
 * out, and the message says so.
 */
export async function switchCheckIn(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = checkInSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const work = workOf(parsed.data)

  const supabase = await createClient()
  const notLive = await liveWorkError(supabase, work)
  if (notLive) return { error: notLive }

  const open = await openEntry(supabase, profile.id)
  if (open.error) return { error: open.error }
  if (open.entry) {
    if (open.entry[WORK_COLUMN[work.kind]] === work.id) {
      revalidatePath('/field', 'layout')
      return { error: 'You are already checked in here.' }
    }
    const closeFailed = await closeOpenEntries(supabase, profile.id)
    if (closeFailed) return { error: closeFailed }
  }

  const failed = await insertOpenEntry(supabase, profile.id, work)
  revalidatePath('/field', 'layout')
  if (failed) {
    return {
      error: open.entry
        ? `You were checked out of the other job, but check-in here failed. Try again. (${failed})`
        : failed,
    }
  }
  return {}
}

// ─── Check out ───────────────────────────────────────────────────────────────

/** Closes the current user's open entry. */
export async function checkOut(): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const open = await openEntry(supabase, profile.id)
  if (open.error) return { error: open.error }
  if (!open.entry) {
    revalidatePath('/field', 'layout')
    return { error: 'No open timesheet entry found.' }
  }

  const failed = await closeOpenEntries(supabase, profile.id)
  if (failed) return { error: failed }

  revalidatePath('/field', 'layout')
  return {}
}

// ─── Manual entry ────────────────────────────────────────────────────────────

/**
 * Inserts a closed entry with explicit Brisbane start and finish times, for
 * today or yesterday, on any live job or project.
 */
export async function createManualEntry(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = manualEntrySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { date, start_time, end_time } = parsed.data
  if (date !== todayAU() && date !== yesterdayAU()) {
    return { error: 'Manual time can only be added for today or yesterday.' }
  }
  const work = workOf(parsed.data)

  const supabase = await createClient()
  const notLive = await liveWorkError(supabase, work)
  if (notLive) return { error: notLive }

  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: profile.id,
    assignment_id: await findAssignmentId(supabase, profile.id, date, work),
    job_id: work.kind === 'job' ? work.id : null,
    project_id: work.kind === 'project' ? work.id : null,
    date,
    // Brisbane wall-clock → UTC instant. Never new Date('…T07:00:00') here:
    // that reads the server's own zone.
    start_at: auLocalToInstant(`${date}T${start_time}`),
    end_at: auLocalToInstant(`${date}T${end_time}`),
    approved: false,
  })
  if (error) return { error: error.message }

  revalidatePath('/field', 'layout')
  return {}
}
