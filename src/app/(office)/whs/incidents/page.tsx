import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { PageHeader } from '@/components/PageHeader'
import {
  IncidentsTable,
  type IncidentRow,
  type ProjectOption,
  type JobOption,
  type ProfileOption,
} from './incidents-table'
import type { IncidentType } from '@/lib/zod'

export default async function WhsIncidentsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const today = todayAU()

  const [{ data: incidents }, { data: projects }, { data: jobs }, { data: actions }, { data: profileRows }] =
    await Promise.all([
      supabase
        .from('incidents')
        .select(
          `id, number, type, severity, occurred_at, location, description,
           status, reported_by, project_id, job_id,
           projects(number, name),
           jobs(number, title),
           profiles!incidents_reported_by_fkey(full_name)`
        )
        .order('occurred_at', { ascending: false }),
      supabase
        .from('projects')
        .select('id, number, name')
        .eq('status', 'active')
        .order('number'),
      supabase
        .from('jobs')
        .select('id, number, title')
        .in('status', ['scheduled', 'in_progress'])
        .order('number'),
      supabase
        .from('corrective_actions')
        .select('incident_id, status, due_date'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name'),
    ])

  // Build action count lookup
  const actionsByIncident = new Map<
    string,
    { open: number; overdue: number }
  >()
  for (const a of actions ?? []) {
    const incId = a.incident_id as string
    const entry = actionsByIncident.get(incId) ?? { open: 0, overdue: 0 }
    if (a.status === 'open') {
      entry.open++
      if (a.due_date && (a.due_date as string) < today) entry.overdue++
    }
    actionsByIncident.set(incId, entry)
  }

  const rows: IncidentRow[] = (incidents ?? []).map((inc) => {
    const project = inc.projects as unknown as {
      number: string
      name: string
    } | null
    const job = inc.jobs as unknown as {
      number: string
      title: string
    } | null
    const reporter = inc.profiles as unknown as { full_name: string } | null
    const counts = actionsByIncident.get(inc.id as string) ?? {
      open: 0,
      overdue: 0,
    }
    return {
      id: inc.id as string,
      number: inc.number as string,
      type: inc.type as IncidentType,
      severity: Number(inc.severity),
      occurred_at: inc.occurred_at as string,
      location: (inc.location as string | null) ?? null,
      description: inc.description as string,
      status: inc.status as string,
      reported_by_name: reporter?.full_name ?? null,
      project_id: (inc.project_id as string | null) ?? null,
      project_label: project ? `${project.number} — ${project.name}` : null,
      job_id: (inc.job_id as string | null) ?? null,
      job_label: job ? `${job.number} — ${job.title}` : null,
      open_action_count: counts.open,
      overdue_action_count: counts.overdue,
    }
  })

  const projectOptions: ProjectOption[] = (projects ?? []).map((p) => ({
    id: p.id as string,
    number: p.number as string,
    name: p.name as string,
  }))

  const jobOptions: JobOption[] = (jobs ?? []).map((j) => ({
    id: j.id as string,
    number: j.number as string,
    title: j.title as string,
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Incident register"
        description="Track and manage workplace incidents and corrective actions."
      />
      <IncidentsTable
        incidents={rows}
        projects={projectOptions}
        jobs={jobOptions}
        profiles={profileOptions}
        currentProfileId={profile.id}
      />
    </div>
  )
}
