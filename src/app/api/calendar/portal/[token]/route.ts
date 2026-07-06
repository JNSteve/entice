import { createPublicClient } from '@/lib/supabase/public'
import { dateAU } from '@/lib/tz'
import { buildIcs, type IcsEvent } from '@/lib/ics'
import type { PortalCalendarEvent } from '@/lib/portal-experience'

// Calendar apps poll without cookies — the client-link token IS the
// credential, validated exactly like the portal pages (revoked/expired → 404).
export const dynamic = 'force-dynamic'

type PortalBrandingLite = {
  client_name: string
  company_name: string
}

/**
 * Per-client-link ICS feed: the same compliance review-due dates and works
 * start/finish dates the portal Calendar page shows (portal_calendar RPC,
 * past 14 days → next 90), as all-day events. Access is logged to
 * portal_views like every other portal read. NO money data.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params
  if (!token || token.length < 16 || token.length > 200) {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createPublicClient()

  const { data: resolved, error: resolveError } = await supabase.rpc(
    'portal_resolve_link',
    { p_token: token }
  )
  if (resolveError) {
    console.error('[calendar] portal link resolve failed:', resolveError.message)
    return new Response('Feed unavailable', { status: 500 })
  }
  const branding = (resolved ?? null) as PortalBrandingLite | null
  if (!branding) return new Response('Not found', { status: 404 })

  const from = dateAU(-14)
  const to = dateAU(90)
  const [{ data: eventsData, error: eventsError }] = await Promise.all([
    supabase.rpc('portal_calendar', { p_token: token, p_from: from, p_to: to }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: 'feed:calendar-ics',
    }),
  ])
  if (eventsError) {
    console.error('[calendar] portal feed query failed:', eventsError.message)
    return new Response('Feed unavailable', { status: 500 })
  }

  const events: IcsEvent[] = (
    ((eventsData ?? []) as PortalCalendarEvent[]) ?? []
  ).map((e) => {
    if (e.kind === 'compliance') {
      return {
        uid: `compliance-${e.item_id}-${e.date}@entice`,
        date: e.date,
        summary: `Review due — ${e.title}`,
        location: e.site_name,
        description: e.site_name ? `Property: ${e.site_name}` : null,
      }
    }
    const edgeLabel = e.edge === 'finish' ? 'finishes' : 'starts'
    return {
      uid: `work-${e.work_type}-${e.number}-${e.edge}@entice`,
      date: e.date,
      summary: `${e.number} — ${e.title} (${edgeLabel})`,
      location: e.site_name,
      description: e.site_name ? `Property: ${e.site_name}` : null,
    }
  })

  const ics = buildIcs({
    calendarName: `${branding.company_name} — ${branding.client_name}`,
    events,
  })

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="entice-calendar.ics"',
      'Cache-Control': 'public, s-maxage=900',
    },
  })
}
