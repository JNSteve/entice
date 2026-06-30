import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { todayAU, yesterdayAU } from '@/lib/tz'
import {
  DiaryForm,
  type DiaryData,
  type LabourRow,
  type PlantRow,
  type PlantOption,
  type LabourSuggestion,
} from './diary-form'

export default async function FieldDiaryEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { projectId } = await params
  const { date: rawDate } = await searchParams

  const todayStr = todayAU()
  const yesterdayStr = yesterdayAU()
  // Today + yesterday (backfill) only — anything else falls back to today.
  const date = rawDate === yesterdayStr ? yesterdayStr : todayStr

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, number, name, status')
    .eq('id', projectId)
    .single()
  if (!project) notFound()

  const [{ data: diaryRow }, { data: plantRows }, { data: assignmentRows }] =
    await Promise.all([
      supabase
        .from('diaries')
        .select('id, weather, work_performed, delays, instructions, visitors, created_by')
        .eq('project_id', projectId)
        .eq('date', date)
        .maybeSingle(),
      supabase
        .from('plant')
        .select('id, name, type')
        .eq('active', true)
        .order('name'),
      supabase
        .from('assignments')
        .select('user_id, profiles!assignments_user_id_fkey(full_name)')
        .eq('project_id', projectId)
        .eq('date', date),
    ])

  const diary: DiaryData | null = diaryRow
    ? {
        id: diaryRow.id,
        weather: diaryRow.weather ?? null,
        work_performed: diaryRow.work_performed ?? '',
        delays: diaryRow.delays ?? '',
        instructions: diaryRow.instructions ?? '',
        visitors: diaryRow.visitors ?? '',
      }
    : null

  let labour: LabourRow[] = []
  let plant: PlantRow[] = []
  let photos: Awaited<ReturnType<typeof fetchAttachmentsWithUrls>> = []

  if (diaryRow) {
    const [{ data: labourRows }, { data: diaryPlantRows }, attachments] =
      await Promise.all([
        supabase
          .from('diary_labour')
          .select('id, user_id, name, trade, headcount, hours')
          .eq('diary_id', diaryRow.id)
          .order('id'),
        supabase
          .from('diary_plant')
          .select('id, plant_id, name, status, hours')
          .eq('diary_id', diaryRow.id)
          .order('id'),
        fetchAttachmentsWithUrls(supabase, 'diary', diaryRow.id),
      ])

    labour = (labourRows ?? []).map((r) => ({
      id: r.id,
      user_id: r.user_id ?? null,
      name: r.name,
      trade: r.trade ?? null,
      headcount: Number(r.headcount),
      hours: Number(r.hours),
    }))
    plant = (diaryPlantRows ?? []).map((r) => ({
      id: r.id,
      plant_id: r.plant_id ?? null,
      name: r.name,
      status: r.status as PlantRow['status'],
      hours: Number(r.hours),
    }))
    photos = attachments
  }

  const plantOptions: PlantOption[] = (plantRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type ?? null,
  }))

  // Suggestion chips: people assigned to this project on the diary date.
  const seen = new Set<string>()
  const suggestions: LabourSuggestion[] = []
  for (const row of assignmentRows ?? []) {
    const profileRel = row.profiles as unknown as { full_name: string } | null
    if (!row.user_id || !profileRel || seen.has(row.user_id)) continue
    seen.add(row.user_id)
    suggestions.push({ user_id: row.user_id, name: profileRel.full_name })
  }

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/diary"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All projects
        </Link>
        <h1 className="text-lg font-bold">
          P-{project.number} — {project.name}
        </h1>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
      </div>

      {/* Date toggle: today + yesterday backfill */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/field/diary/${projectId}`}
          className={
            date === todayStr
              ? 'rounded-xl border-2 border-foreground px-3 py-2 text-center text-sm font-semibold'
              : 'rounded-xl border px-3 py-2 text-center text-sm text-muted-foreground'
          }
        >
          Today
        </Link>
        <Link
          href={`/field/diary/${projectId}?date=${yesterdayStr}`}
          className={
            date === yesterdayStr
              ? 'rounded-xl border-2 border-foreground px-3 py-2 text-center text-sm font-semibold'
              : 'rounded-xl border px-3 py-2 text-center text-sm text-muted-foreground'
          }
        >
          Yesterday
        </Link>
      </div>

      {project.status === 'closed' ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          This project is closed — diary entries are no longer accepted.
        </p>
      ) : (
        <DiaryForm
          projectId={projectId}
          date={date}
          diary={diary}
          labour={labour}
          plant={plant}
          photos={photos}
          plantOptions={plantOptions}
          suggestions={suggestions}
        />
      )}
    </div>
  )
}
