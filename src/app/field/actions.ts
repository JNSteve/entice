'use server'

import { revalidatePath } from 'next/cache'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { checkInSchema, manualEntrySchema } from '@/lib/zod'
import { redirect } from 'next/navigation'

type Result = { error?: string }

// ─── Check in ────────────────────────────────────────────────────────────────

/**
 * Opens a new timesheet entry for the current user.
 * Rejects if they already have an open entry (end_at IS NULL).
 */
export async function checkIn(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = checkInSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Guard: reject if ANY open entry exists
  const { data: open } = await supabase
    .from('timesheet_entries')
    .select('id')
    .eq('user_id', profile.id)
    .is('end_at', null)
    .maybeSingle()

  if (open) {
    return { error: 'You are already checked in. Check out first.' }
  }

  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: profile.id,
    assignment_id: parsed.data.assignment_id,
    job_id: parsed.data.job_id,
    project_id: parsed.data.project_id,
    date: parsed.data.date,
    start_at: new Date().toISOString(),
    approved: false,
  })

  if (error) return { error: error.message }

  revalidatePath('/field')
  return {}
}

// ─── Check out ───────────────────────────────────────────────────────────────

/**
 * Closes the current user's open entry.
 */
export async function checkOut(): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const { data: open } = await supabase
    .from('timesheet_entries')
    .select('id')
    .eq('user_id', profile.id)
    .is('end_at', null)
    .maybeSingle()

  if (!open) {
    return { error: 'No open timesheet entry found.' }
  }

  const { error } = await supabase
    .from('timesheet_entries')
    .update({ end_at: new Date().toISOString() })
    .eq('id', open.id)
    .eq('user_id', profile.id)

  if (error) return { error: error.message }

  revalidatePath('/field')
  return {}
}

// ─── Manual entry ─────────────────────────────────────────────────────────────

/**
 * Inserts a closed timesheet entry with explicit start/end times.
 * Validates end > start. Entry is inserted already closed (no open-entry check).
 */
export async function createManualEntry(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = manualEntrySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const { date, start_time, end_time, assignment_id, job_id, project_id } =
    parsed.data

  const startAt = new Date(`${date}T${start_time}:00`)
  const endAt = new Date(`${date}T${end_time}:00`)

  // Basic sanity — both must parse to valid dates within ±1 day of today
  const today = new Date()
  const msPerDay = 86400000
  if (
    isNaN(startAt.getTime()) ||
    isNaN(endAt.getTime()) ||
    Math.abs(startAt.getTime() - today.getTime()) > msPerDay * 2
  ) {
    return { error: 'Times must be within today (±1 day).' }
  }

  const supabase = await createClient()

  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: profile.id,
    assignment_id,
    job_id,
    project_id,
    date,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    approved: false,
  })

  if (error) return { error: error.message }

  revalidatePath('/field')
  return {}
}
