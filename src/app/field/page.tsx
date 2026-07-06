import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU, dateAU } from '@/lib/tz'
import { CalendarFeedCard } from '@/components/CalendarFeedCard'
import { MyDayClient, type AssignmentCard, type OpenEntry, type TomorrowItem, type WeekSummary } from './my-day-client'

export default async function MyDayPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name

  const supabase = await createClient()

  // Today + tomorrow as YYYY-MM-DD in Australian (Brisbane) time.
  const todayStr = todayAU()
  const tomorrowStr = dateAU(1)

  // Week start (Monday) derived from the AU calendar day.
  const todayDow = new Date(`${todayStr}T00:00:00Z`).getUTCDay() // 0=Sun
  const daysFromMonday = todayDow === 0 ? 6 : todayDow - 1
  const weekStartStr = dateAU(-daysFromMonday)

  // ─── Today's assignments ─────────────────────────────────────────────────

  const { data: rawAssignments } = await supabase
    .from('assignments')
    .select(`
      id,
      job_id,
      project_id,
      note,
      jobs:job_id (
        number,
        title,
        site_id,
        client_id,
        sites:site_id ( name, address, suburb, state, postcode ),
        clients:client_id ( contacts ( phone ) )
      ),
      projects:project_id (
        number,
        name,
        site_id,
        client_id,
        sites:site_id ( name, address, suburb, state, postcode ),
        clients:client_id ( contacts ( phone ) )
      )
    `)
    .eq('user_id', profile.id)
    .eq('date', todayStr)

  // ─── Open timesheet entry ─────────────────────────────────────────────────

  const { data: openRow } = await supabase
    .from('timesheet_entries')
    .select(`
      id,
      assignment_id,
      start_at,
      job_id,
      project_id,
      jobs:job_id ( number, title ),
      projects:project_id ( number, name )
    `)
    .eq('user_id', profile.id)
    .is('end_at', null)
    .maybeSingle()

  // ─── Tomorrow's assignments ───────────────────────────────────────────────

  const { data: tomorrowRows } = await supabase
    .from('assignments')
    .select(`
      job_id,
      project_id,
      jobs:job_id ( number, title ),
      projects:project_id ( number, name )
    `)
    .eq('user_id', profile.id)
    .eq('date', tomorrowStr)

  // ─── This week summary ────────────────────────────────────────────────────

  const { data: weekRows } = await supabase
    .from('timesheet_entries')
    .select('start_at, end_at')
    .eq('user_id', profile.id)
    .gte('date', weekStartStr)
    .lte('date', todayStr)
    .not('end_at', 'is', null)

  // ─── Calendar feed token (own row only — RLS select self) ────────────────

  const { data: feedToken } = await supabase
    .from('calendar_feed_tokens')
    .select('token, revoked_at')
    .eq('profile_id', profile.id)
    .maybeSingle()

  // ─── Shape data ───────────────────────────────────────────────────────────

  const assignments: AssignmentCard[] = (rawAssignments ?? []).map((row) => {
    // Supabase returns joined tables as objects or arrays — normalise
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects

    if (job) {
      const site = Array.isArray(job.sites) ? job.sites[0] : job.sites
      const client = Array.isArray(job.clients) ? job.clients[0] : job.clients
      const contacts: Array<{ phone?: string | null }> = client?.contacts ?? []
      const addressParts = [site?.address, site?.suburb, site?.state, site?.postcode].filter(Boolean)
      return {
        id: row.id,
        target_type: 'job' as const,
        number: job.number,
        title: job.title,
        site_name: site?.name ?? null,
        site_address: addressParts.join(' ') || null,
        note: row.note ?? null,
        contact_phone: contacts[0]?.phone ?? null,
        job_id: row.job_id,
        project_id: null,
        date: todayStr,
      }
    }

    const proj = project!
    const site = Array.isArray(proj.sites) ? proj.sites[0] : proj.sites
    const client = Array.isArray(proj.clients) ? proj.clients[0] : proj.clients
    const contacts: Array<{ phone?: string | null }> = client?.contacts ?? []
    const addressParts = [site?.address, site?.suburb, site?.state, site?.postcode].filter(Boolean)
    return {
      id: row.id,
      target_type: 'project' as const,
      number: proj.number,
      title: proj.name,
      site_name: site?.name ?? null,
      site_address: addressParts.join(' ') || null,
      note: row.note ?? null,
      contact_phone: contacts[0]?.phone ?? null,
      job_id: null,
      project_id: row.project_id,
      date: todayStr,
    }
  })

  const openEntry: OpenEntry | null = openRow
    ? (() => {
        const j = Array.isArray(openRow.jobs) ? openRow.jobs[0] : openRow.jobs
        const p = Array.isArray(openRow.projects) ? openRow.projects[0] : openRow.projects
        return {
          id: openRow.id,
          assignment_id: openRow.assignment_id,
          start_at: openRow.start_at,
          job_number: j?.number ?? null,
          job_title: j?.title ?? null,
          project_number: p?.number ?? null,
          project_name: p?.name ?? null,
        }
      })()
    : null

  const tomorrow: TomorrowItem[] = (tomorrowRows ?? []).map((row) => {
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects
    if (job) return { number: `J-${job.number}`, title: job.title }
    return { number: `P-${project!.number}`, title: project!.name }
  })

  const weekSummary: WeekSummary = (() => {
    let totalMs = 0
    for (const row of weekRows ?? []) {
      if (row.end_at && row.start_at) {
        totalMs += new Date(row.end_at).getTime() - new Date(row.start_at).getTime()
      }
    }
    return {
      hours: totalMs / 3600000,
      entries: weekRows?.length ?? 0,
    }
  })()

  // ─── Greeting ────────────────────────────────────────────────────────────

  // Greeting hour + date label in Brisbane time (server may run in UTC).
  const now = new Date()
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Australia/Brisbane',
      hour: '2-digit',
      hour12: false,
    }).format(now)
  )
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const dateLabel = now.toLocaleDateString('en-AU', {
    timeZone: 'Australia/Brisbane',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
      </div>

      <MyDayClient
        assignments={assignments}
        openEntry={openEntry}
        tomorrow={tomorrow}
        weekSummary={weekSummary}
        today={todayStr}
      />

      <CalendarFeedCard
        initialToken={
          feedToken && !feedToken.revoked_at ? (feedToken.token as string) : null
        }
      />
    </div>
  )
}
