'use server'

// Staff calendar-feed token management (feature: ICS calendar feeds). The
// token is the credential for /api/calendar/staff/[token] — generated
// server-side only (regenerate_calendar_feed_token definer fn, migration
// 0035) and readable only by its owner (RLS: select self). Regenerating
// replaces the token, killing the old URL instantly.

import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function regenerateCalendarFeedToken(): Promise<{
  token?: string
  error?: string
}> {
  // Every staff role may subscribe to their own schedule.
  await requireRole('admin', 'office', 'supervisor', 'field')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('regenerate_calendar_feed_token')
  if (error) return { error: error.message }
  if (typeof data !== 'string' || data.length < 32) {
    return { error: 'Could not create a calendar link — try again' }
  }
  return { token: data }
}
