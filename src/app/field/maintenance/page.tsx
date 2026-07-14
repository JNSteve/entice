import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU, dateAU } from '@/lib/tz'
import {
  MaintenanceForm,
  type SiteOption,
  type MaintenanceTarget,
} from './maintenance-form'

export default async function FieldMaintenancePage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const todayStr = todayAU()

  // Week start (Monday) derived from the AU calendar day — mirrors the photo
  // page so "recent targets" cover this week's assignments.
  const todayDow = new Date(`${todayStr}T00:00:00Z`).getUTCDay()
  const daysFromMonday = todayDow === 0 ? 6 : todayDow - 1
  const weekStartStr = dateAU(-daysFromMonday)

  const [{ data: siteRows }, { data: assignmentRows }] = await Promise.all([
    supabase.from('sites').select('id, name, client_id, clients(name)').order('name'),
    supabase
      .from('assignments')
      .select(`
        job_id,
        project_id,
        jobs:job_id ( id, number, title, site_id ),
        projects:project_id ( id, number, name, site_id )
      `)
      .eq('user_id', profile.id)
      .gte('date', weekStartStr)
      .lte('date', todayStr),
  ])

  const sites: SiteOption[] = (siteRows ?? []).map((s) => {
    const client = Array.isArray(s.clients) ? s.clients[0] : s.clients
    return {
      id: s.id as string,
      name: s.name as string,
      client_name: (client?.name as string | undefined) ?? null,
    }
  })

  // Deduplicate this week's assignment targets by id (mirrors the photo page).
  const seenIds = new Set<string>()
  const recentTargets: MaintenanceTarget[] = []
  for (const row of assignmentRows ?? []) {
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects

    if (job && !seenIds.has(job.id)) {
      seenIds.add(job.id)
      recentTargets.push({
        id: job.id,
        type: 'job',
        number: job.number,
        label: job.title,
        site_id: (job.site_id as string | null) ?? null,
      })
    } else if (project && !seenIds.has(project.id)) {
      seenIds.add(project.id)
      recentTargets.push({
        id: project.id,
        type: 'project',
        number: project.number,
        label: project.name,
        site_id: (project.site_id as string | null) ?? null,
      })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Maintenance log</h1>
        <p className="text-sm text-muted-foreground">
          Record a make-safe, repair, maintenance or inspection against a
          property — then add photo evidence.
        </p>
      </div>

      <MaintenanceForm
        sites={sites}
        recentTargets={recentTargets}
        today={todayStr}
      />
    </div>
  )
}
