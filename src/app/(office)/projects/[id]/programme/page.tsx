import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Gantt, type ProgrammeTask } from './gantt'

export default async function ProjectProgrammePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const canDelete = profile.role === 'admin' || profile.role === 'office'

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: tasks }] = await Promise.all([
    supabase.from('projects').select('id, start_date').eq('id', id).single(),
    supabase
      .from('programme_tasks')
      .select('id, name, phase, start_date, end_date, progress_pct, position')
      .eq('project_id', id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (!project) notFound()

  const rows: ProgrammeTask[] = (tasks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    phase: t.phase ?? null,
    start_date: t.start_date,
    end_date: t.end_date,
    progress_pct: Number(t.progress_pct),
    position: t.position,
  }))

  return (
    <section className="flex flex-col gap-4">
      <Gantt
        projectId={id}
        tasks={rows}
        projectStartDate={project.start_date ?? null}
        canDelete={canDelete}
      />
    </section>
  )
}
