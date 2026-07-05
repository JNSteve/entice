import Link from 'next/link'
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { fmtDate } from '@/lib/format'
import { derivePropertyItemStatus } from '@/lib/portal'
import {
  addMonths,
  bucketEventsByDay,
  buildMonthGrid,
  itemKindLabel,
  monthLabel,
  monthRange,
  parseMonthParam,
  type PortalCalendarEvent,
} from '@/lib/portal-experience'
import {
  EmptyState,
  LinkInactivePage,
  PortalCard,
  PortalShell,
  STATUS_DOT,
  type PortalBranding,
} from '../portal-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Consistent colour language: compliance = status colour, works = blue. */
function eventDotClass(event: PortalCalendarEvent, today: string): string {
  if (event.kind === 'work') return 'bg-blue-500'
  return STATUS_DOT[derivePropertyItemStatus(event.date, today)]
}

function eventVerb(event: PortalCalendarEvent): string {
  if (event.kind === 'compliance') return 'Review due'
  return event.edge === 'finish' ? 'Finishes' : 'Starts'
}

/**
 * Portfolio calendar: one month of compliance review-due dates (status
 * coloured) and works start/finish dates (blue) across every property on the
 * client's link. Month grid + agenda, or a plain agenda list — both server
 * rendered; month navigation is plain links so every view is logged.
 * All dates are Brisbane calendar days end to end.
 */
export default async function PortalCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ m?: string; view?: string }>
}) {
  const { token } = await params
  const { m, view } = await searchParams

  const today = todayAU()
  const month = parseMonthParam(m, today.slice(0, 7))
  const activeView = view === 'list' ? 'list' : 'month'
  const { from, to } = monthRange(month)

  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />

  const [{ data: eventsData }] = await Promise.all([
    supabase.rpc('portal_calendar', { p_token: token, p_from: from, p_to: to }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: `/portal/calendar?m=${month}&view=${activeView}`,
    }),
  ])
  const events = ((eventsData ?? []) as PortalCalendarEvent[]) ?? []
  const byDay = bucketEventsByDay(events)
  const grid = buildMonthGrid(month)

  const monthHref = (ym: string) =>
    `/portal/${token}/calendar?m=${ym}${activeView === 'list' ? '&view=list' : ''}`
  const viewHref = (v: 'month' | 'list') =>
    `/portal/${token}/calendar?m=${month}${v === 'list' ? '&view=list' : ''}`

  const viewTabClass = (isActive: boolean) =>
    `flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
      isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
    }`

  return (
    <PortalShell branding={branding} token={token} active="calendar">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Calendar
        </h1>
        <p className="text-sm text-slate-500">
          Compliance review dates and works across your properties.
        </p>
      </div>

      {/* Month nav + view toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={monthHref(addMonths(month, -1))}
            aria-label="Previous month"
            className="flex size-11 items-center justify-center rounded-xl border bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          >
            <ChevronLeftIcon className="size-5" />
          </Link>
          <span className="min-w-32 px-2 text-center text-sm font-semibold text-slate-900">
            {monthLabel(month)}
          </span>
          <Link
            href={monthHref(addMonths(month, 1))}
            aria-label="Next month"
            className="flex size-11 items-center justify-center rounded-xl border bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          >
            <ChevronRightIcon className="size-5" />
          </Link>
        </div>

        <div className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
          <Link href={viewHref('month')} className={viewTabClass(activeView === 'month')}>
            <CalendarDaysIcon className="size-4" />
            <span className="hidden sm:inline">Month</span>
          </Link>
          <Link href={viewHref('list')} className={viewTabClass(activeView === 'list')}>
            <ListIcon className="size-4" />
            <span className="hidden sm:inline">List</span>
          </Link>
        </div>
      </div>

      {activeView === 'month' && (
        <PortalCard className="p-2.5 sm:p-4">
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="pb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {d}
              </div>
            ))}
            {grid.flat().map((date, i) => {
              if (!date) {
                return <div key={`pad-${i}`} className="min-h-12" />
              }
              const dayEvents = byDay.get(date) ?? []
              const isToday = date === today
              return (
                <div
                  key={date}
                  className={`flex min-h-12 flex-col items-center gap-1 rounded-lg py-1.5 ${
                    isToday ? 'bg-[#1e3a5f]/5 ring-1 ring-[#1e3a5f]/25' : ''
                  }`}
                >
                  <span
                    className={`text-xs tabular-nums ${
                      isToday
                        ? 'flex size-5 items-center justify-center rounded-full bg-[#1e3a5f] font-semibold text-white'
                        : 'text-slate-600'
                    }`}
                  >
                    {Number(date.slice(8, 10))}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      {dayEvents.slice(0, 3).map((event, j) => (
                        <span
                          key={j}
                          className={`size-1.5 rounded-full ${eventDotClass(event, today)}`}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[9px] font-medium leading-none text-slate-400">
                          +{dayEvents.length - 3}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-500" />
              Overdue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-400" />
              Review due soon
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-green-500" />
              Review scheduled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-blue-500" />
              Works
            </span>
          </div>
        </PortalCard>
      )}

      {/* Agenda */}
      <div className="flex flex-col gap-3">
        {activeView === 'month' && events.length > 0 && (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            This month
          </h2>
        )}

        {events.length === 0 ? (
          <EmptyState>Nothing scheduled in {monthLabel(month)}.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {[...byDay.entries()].map(([date, dayEvents]) => (
              <li key={date}>
                <PortalCard className="overflow-hidden">
                  <p
                    className={`border-b px-4 py-2 text-xs font-semibold ${
                      date === today
                        ? 'bg-[#1e3a5f]/5 text-[#1e3a5f]'
                        : 'bg-slate-50 text-slate-500'
                    }`}
                  >
                    {fmtDate(date)}
                    {date === today && ' — today'}
                  </p>
                  <ul className="divide-y">
                    {dayEvents.map((event, i) => (
                      <li key={i}>
                        <Link
                          href={`/portal/${token}/sites/${event.site_id}${
                            event.kind === 'work' ? '?tab=works' : ''
                          }`}
                          className="flex min-h-11 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50"
                        >
                          <span
                            className={`size-2.5 shrink-0 rounded-full ${eventDotClass(event, today)}`}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {event.title}
                            </span>
                            <span className="truncate text-xs text-slate-500">
                              {eventVerb(event)}
                              {event.kind === 'compliance' && event.item_kind
                                ? ` — ${itemKindLabel(event.item_kind)}`
                                : ''}
                              {event.kind === 'work' && event.number
                                ? ` — ${event.number}`
                                : ''}
                              {' · '}
                              {event.site_name}
                            </span>
                          </span>
                          <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </PortalCard>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
