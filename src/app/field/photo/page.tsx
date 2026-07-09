import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU, dateAU } from '@/lib/tz'
import { CaptureClient, type CaptureTarget } from './capture-client'

export default async function FieldPhotoPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const todayStr = todayAU()

  // Week start (Monday) derived from the AU calendar day.
  const todayDow = new Date(`${todayStr}T00:00:00Z`).getUTCDay()
  const daysFromMonday = todayDow === 0 ? 6 : todayDow - 1
  const weekStartStr = dateAU(-daysFromMonday)

  // ─── This week's assignment targets (distinct) ────────────────────────────

  const { data: assignmentRows } = await supabase
    .from('assignments')
    .select(`
      job_id,
      project_id,
      jobs:job_id ( id, number, title ),
      projects:project_id ( id, number, name )
    `)
    .eq('user_id', profile.id)
    .gte('date', weekStartStr)
    .lte('date', todayStr)

  // Deduplicate by target id
  const seenIds = new Set<string>()
  const recentTargets: CaptureTarget[] = []

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
      })
    } else if (project && !seenIds.has(project.id)) {
      seenIds.add(project.id)
      recentTargets.push({
        id: project.id,
        type: 'project',
        number: project.number,
        label: project.name,
      })
    }
  }

  // ─── All active jobs + projects for search ───────────────────────────────

  const [{ data: jobRows }, { data: projectRows }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, number, title, status')
      .eq('archived', false)
      .not('status', 'in', '("invoiced","paid","lost")')
      .order('number'),
    supabase
      .from('projects')
      .select('id, number, name, status')
      .eq('archived', false)
      .neq('status', 'closed')
      .order('number'),
  ])

  const allTargets: CaptureTarget[] = [
    ...(jobRows ?? []).map((j) => ({
      id: j.id,
      type: 'job' as const,
      number: j.number,
      label: j.title,
    })),
    ...(projectRows ?? []).map((p) => ({
      id: p.id,
      type: 'project' as const,
      number: p.number,
      label: p.name,
    })),
  ]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Photos &amp; Dockets</h1>
        <p className="text-sm text-muted-foreground">
          Pick a target, then capture photos or attach dockets.
        </p>
      </div>

      <CaptureClient
        recentTargets={recentTargets}
        allTargets={allTargets}
        today={todayStr}
      />
    </div>
  )
}
