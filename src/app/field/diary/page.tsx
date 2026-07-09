import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { ProjectPicker, type PickerProject } from './project-picker'

export default async function DiaryProjectPickerPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const todayStr = todayAU()

  const [{ data: assignedRows }, { data: projectRows }] = await Promise.all([
    supabase
      .from('assignments')
      .select('project_id')
      .eq('user_id', profile.id)
      .eq('date', todayStr)
      .not('project_id', 'is', null),
    supabase
      .from('projects')
      .select('id, number, name, status')
      .eq('archived', false)
      .neq('status', 'closed')
      .order('number'),
  ])

  const assignedIds = new Set(
    (assignedRows ?? []).map((r) => r.project_id as string)
  )

  const projects: PickerProject[] = (projectRows ?? []).map((p) => ({
    id: p.id,
    number: p.number,
    name: p.name,
  }))

  const assigned = projects.filter((p) => assignedIds.has(p.id))
  const others = projects.filter((p) => !assignedIds.has(p.id))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Site diary</h1>
        <p className="text-sm text-muted-foreground">
          Pick a project to record today&apos;s diary.
        </p>
      </div>

      <ProjectPicker assigned={assigned} others={others} />
    </div>
  )
}
