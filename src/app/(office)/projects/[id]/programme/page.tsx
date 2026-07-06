import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ProgrammeView } from './programme-view'
import type { HoldPoint, ProgrammeLink, ProgrammeTask } from './types'

export default async function ProjectProgrammePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const canDelete = profile.role === 'admin' || profile.role === 'office'
  const canSetBaseline = canDelete

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: tasks }, { data: links }, { data: holdPoints }] =
    await Promise.all([
      supabase.from('projects').select('id, start_date').eq('id', id).single(),
      supabase
        .from('programme_tasks')
        .select(
          'id, name, phase, start_date, end_date, progress_pct, position, baseline_start, baseline_end'
        )
        .eq('project_id', id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('programme_links')
        .select('id, predecessor_id, successor_id')
        .eq('project_id', id),
      supabase
        .from('hold_points')
        .select(
          'id, task_id, title, required_by, date, status, notified_at, released_at, released_by, release_ref, notes'
        )
        .eq('project_id', id)
        // Quality-origin hold points (lots) live on the project Quality tab —
        // the programme register/Gantt shows task hold points only.
        .eq('origin', 'programme')
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

  if (!project) notFound()

  const taskRows: ProgrammeTask[] = (tasks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    phase: t.phase ?? null,
    start_date: t.start_date,
    end_date: t.end_date,
    progress_pct: Number(t.progress_pct),
    position: t.position,
    baseline_start: t.baseline_start ?? null,
    baseline_end: t.baseline_end ?? null,
  }))

  const linkRows: ProgrammeLink[] = (links ?? []).map((l) => ({
    id: l.id,
    predecessor_id: l.predecessor_id,
    successor_id: l.successor_id,
  }))

  const holdPointRows: HoldPoint[] = (holdPoints ?? []).map((hp) => ({
    id: hp.id,
    task_id: hp.task_id,
    title: hp.title,
    required_by: hp.required_by,
    date: hp.date,
    status: hp.status as HoldPoint['status'],
    notified_at: hp.notified_at ?? null,
    released_at: hp.released_at ?? null,
    released_by: hp.released_by ?? null,
    release_ref: hp.release_ref ?? null,
    notes: hp.notes ?? null,
  }))

  return (
    <section className="flex flex-col gap-4">
      <ProgrammeView
        projectId={id}
        tasks={taskRows}
        links={linkRows}
        holdPoints={holdPointRows}
        projectStartDate={project.start_date ?? null}
        canDelete={canDelete}
        canSetBaseline={canSetBaseline}
        isAdmin={profile.role === 'admin'}
      />
    </section>
  )
}
