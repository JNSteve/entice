import { createPublicClient } from '@/lib/supabase/public'
import { buildIcs, type IcsEvent } from '@/lib/ics'

// Calendar apps poll without cookies — the token IS the credential (same
// trust model as portal links). Always resolve it fresh.
export const dynamic = 'force-dynamic'

type StaffFeedEvent = {
  uid: string
  date: string
  number: string | null
  title: string | null
  note: string | null
  site_name: string | null
  site_address: string | null
}

type StaffFeedPayload = {
  full_name: string
  role: string
  events: StaffFeedEvent[]
}

/**
 * Per-staff ICS feed: the person's schedule assignments (past 14 days, next
 * 90) as all-day events — plus scheduled portal work requests for
 * admin/office people. Token issued/revoked via
 * regenerate_calendar_feed_token(); a wrong or replaced token is a plain 404.
 * NO money data. Modest edge caching only (calendar apps poll hourly-ish).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params
  if (!token || token.length < 32 || token.length > 200) {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('staff_calendar_feed', {
    p_token: token,
  })
  if (error) {
    console.error('[calendar] staff feed query failed:', error.message)
    return new Response('Feed unavailable', { status: 500 })
  }
  const payload = (data ?? null) as StaffFeedPayload | null
  if (!payload) return new Response('Not found', { status: 404 })

  const events: IcsEvent[] = (payload.events ?? []).map((e) => ({
    uid: `${e.uid}@entice`,
    date: e.date,
    summary: e.uid.startsWith('request-')
      ? `${e.number ?? 'REQ'} — ${e.title ?? 'Work request'} (request)`
      : `${e.number ?? ''}${e.number ? ' — ' : ''}${e.title ?? 'Assignment'}`,
    location: e.site_address ?? e.site_name,
    description:
      [e.site_name, e.note].filter(Boolean).join('\n') || null,
  }))

  const ics = buildIcs({
    calendarName: `Entice — ${payload.full_name}`,
    events,
  })

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="entice-schedule.ics"',
      'Cache-Control': 'public, s-maxage=900',
    },
  })
}
