'use server'

import { revalidatePath } from 'next/cache'
import { addDays, format, isValid, parseISO } from 'date-fns'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

type Result = { error?: string }

const entrySchema = z.object({
  entryId: z.string().uuid(),
  approved: z.boolean(),
})

/** Approve (or unapprove) a single closed timesheet entry. */
export async function approveTimesheetEntry(
  entryId: string,
  approved: boolean
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = entrySchema.safeParse({ entryId, approved })
  if (!parsed.success) return { error: 'Invalid data' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('timesheet_entries')
    .update({
      approved: parsed.data.approved,
      approved_by: parsed.data.approved ? profile.id : null,
    })
    .eq('id', parsed.data.entryId)

  if (error) return { error: error.message }

  revalidatePath('/reports')
  return {}
}

const weekSchema = z.object({
  userId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid week start'),
})

/** Approve all of a person's closed entries for the week starting `weekStart` (Monday). */
export async function approveTimesheetWeek(
  userId: string,
  weekStart: string
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = weekSchema.safeParse({ userId, weekStart })
  if (!parsed.success) return { error: 'Invalid data' }

  const start = parseISO(parsed.data.weekStart)
  if (!isValid(start)) return { error: 'Invalid week start' }
  const end = format(addDays(start, 6), 'yyyy-MM-dd')

  const supabase = await createClient()
  const { error } = await supabase
    .from('timesheet_entries')
    .update({ approved: true, approved_by: profile.id })
    .eq('user_id', parsed.data.userId)
    .gte('date', parsed.data.weekStart)
    .lte('date', end)
    .not('end_at', 'is', null)

  if (error) return { error: error.message }

  revalidatePath('/reports')
  return {}
}
