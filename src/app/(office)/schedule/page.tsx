import Link from 'next/link'
import { addDays, startOfWeek, format, eachDayOfInterval } from 'date-fns'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nowAU } from '@/lib/tz'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { CalendarFeedCard } from '@/components/CalendarFeedCard'
import { ScheduleBoard } from './schedule-board'
import type { AssignmentWithTarget, ProfileRow } from './schedule-board'
import type { SchedulableJob, SchedulableProject } from './assign-dialog'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function getWeekMonday(weekParam: string | undefined): Date {
  if (weekParam) {
    const parsed = new Date(weekParam + 'T00:00:00')
    if (!isNaN(parsed.getTime())) {
      return startOfWeek(parsed, { weekStartsOn: 1 })
    }
  }
  return startOfWeek(nowAU(), { weekStartsOn: 1 })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { week: weekParam } = await searchParams

  const monday = getWeekMonday(weekParam)
  const sunday = addDays(monday, 6)
  const weekDays = eachDayOfInterval({ start: monday, end: sunday }).map(toDateStr)

  const todayStr = toDateStr(nowAU())

  // Nav week strings
  const prevWeek = toDateStr(addDays(monday, -7))
  const nextWeek = toDateStr(addDays(monday, 7))
  const thisWeek = toDateStr(startOfWeek(nowAU(), { weekStartsOn: 1 }))

  // Date range label
  const weekLabel =
    format(monday, 'd MMM') + ' – ' + format(sunday, 'd MMM yyyy')

  const supabase = await createClient()

  // Fetch all active profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('active', true)
    .order('full_name')

  // Fetch assignments for this week with job/project join
  const { data: assignments } = await supabase
    .from('assignments')
    .select(`
      id,
      date,
      user_id,
      job_id,
      project_id,
      note,
      jobs ( number, title ),
      projects ( number, name )
    `)
    .gte('date', weekDays[0])
    .lte('date', weekDays[6])
    .order('date')

  // Fetch schedulable jobs (scheduled or in_progress)
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, number, title')
    .in('status', ['scheduled', 'in_progress'])
    .order('number')

  // Fetch schedulable projects (not closed)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, number, name')
    .in('status', ['active', 'practical_completion', 'defects_liability'])
    .order('number')

  // Own calendar-feed token (RLS: select self) for the subscribe card.
  const { data: feedToken } = await supabase
    .from('calendar_feed_tokens')
    .select('token, revoked_at')
    .eq('profile_id', profile.id)
    .maybeSingle()

  const profileRows: ProfileRow[] = (profiles ?? []) as ProfileRow[]
  const assignmentRows = (assignments ?? []) as unknown as AssignmentWithTarget[]
  const jobRows: SchedulableJob[] = (jobs ?? []) as SchedulableJob[]
  const projectRows: SchedulableProject[] = (projects ?? []) as SchedulableProject[]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Schedule"
        description="Weekly crew assignments to jobs and projects."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" render={<Link href={`/schedule?week=${prevWeek}`} />}>
              <ChevronLeftIcon className="size-4" />
              <span className="sr-only">Previous week</span>
            </Button>
            <Button
              variant={thisWeek === toDateStr(monday) ? 'default' : 'outline'}
              size="sm"
              render={<Link href="/schedule" />}
            >
              This week
            </Button>
            <Button variant="outline" size="sm" render={<Link href={`/schedule?week=${nextWeek}`} />}>
              <ChevronRightIcon className="size-4" />
              <span className="sr-only">Next week</span>
            </Button>
          </div>
        }
      />

      {/* Week label */}
      <p className="text-sm text-muted-foreground -mt-4">{weekLabel}</p>

      <ScheduleBoard
        weekDays={weekDays}
        profiles={profileRows}
        assignments={assignmentRows}
        jobs={jobRows}
        projects={projectRows}
        todayStr={todayStr}
      />

      <div className="max-w-xl">
        <CalendarFeedCard
          initialToken={
            feedToken && !feedToken.revoked_at ? (feedToken.token as string) : null
          }
        />
      </div>
    </div>
  )
}
