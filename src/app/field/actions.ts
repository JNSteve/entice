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
    return 'That job is closed — hours can no longer be logged against it.'
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

async function openEntry(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('timesheet_entries')
    .select('id, job_id, project_id')
    .eq('user_id', userId)
    .is('end_at', null)
    .maybeSingle()
  return data as { id: string; job_id: string | null; project_id: string | null } | null
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

  if (await openEntry(supabase, profile.id)) {
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
  if (open) {
    if (open[WORK_COLUMN[work.kind]] === work.id) {
      return { error: 'You are already checked in here.' }
    }
    const { error } = await supabase
      .from('timesheet_entries')
      .update({ end_at: new Date().toISOString() })
      .eq('id', open.id)
      .eq('user_id', profile.id)
    if (error) return { error: error.message }
  }

  const failed = await insertOpenEntry(supabase, profile.id, work)
  revalidatePath('/field', 'layout')
  if (failed) {
    return {
      error: open
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
  if (!open) return { error: 'No open timesheet entry found.' }

  const { error } = await supabase
    .from('timesheet_entries')
    .update({ end_at: new Date().toISOString() })
    .eq('id', open.id)
    .eq('user_id', profile.id)
  if (error) return { error: error.message }

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
