import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { DiaryList, type DiaryEntry } from './diary-list'
import type { AttachmentItem } from '@/components/AttachmentList'

export default async function ProjectDiaryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: diaries }] = await Promise.all([
    supabase.from('projects').select('id').eq('id', id).single(),
    supabase
      .from('diaries')
      .select(
        `id, date, weather, work_performed, delays, instructions, visitors, created_at,
         profiles!diaries_created_by_fkey(full_name)`
      )
      .eq('project_id', id)
      .order('date', { ascending: false }),
  ])

  if (!project) notFound()

  const diaryIds = (diaries ?? []).map((d) => d.id as string)

  // Child rows + photos for every entry (register is small enough to load whole).
  const [{ data: labourRows }, { data: plantRows }] = await Promise.all([
    diaryIds.length > 0
      ? supabase
          .from('diary_labour')
          .select('id, diary_id, name, trade, headcount, hours')
          .in('diary_id', diaryIds)
          .order('id')
      : Promise.resolve({ data: [] as never[] }),
    diaryIds.length > 0
      ? supabase
          .from('diary_plant')
          .select('id, diary_id, name, status, hours')
          .in('diary_id', diaryIds)
          .order('id')
      : Promise.resolve({ data: [] as never[] }),
  ])

  const attachmentsByDiary: Record<string, AttachmentItem[]> = {}
  await Promise.all(
    diaryIds.map(async (diaryId) => {
      attachmentsByDiary[diaryId] = await fetchAttachmentsWithUrls(
        supabase,
        'diary',
        diaryId
      )
    })
  )

  const entries: DiaryEntry[] = (diaries ?? []).map((d) => {
    const authorRel = d.profiles as unknown as { full_name: string } | null
    return {
      id: d.id,
      date: d.date,
      weather: d.weather ?? null,
      work_performed: d.work_performed ?? null,
      delays: d.delays ?? null,
      instructions: d.instructions ?? null,
      visitors: d.visitors ?? null,
      author: authorRel?.full_name ?? null,
      labour: (labourRows ?? [])
        .filter((l) => l.diary_id === d.id)
        .map((l) => ({
          id: l.id,
          name: l.name,
          trade: l.trade ?? null,
          headcount: Number(l.headcount),
          hours: Number(l.hours),
        })),
      plant: (plantRows ?? [])
        .filter((p) => p.diary_id === d.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          hours: Number(p.hours),
        })),
    }
  })

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Site diary</h2>
      <DiaryList
        projectId={id}
        entries={entries}
        attachmentsByDiary={attachmentsByDiary}
      />
    </section>
  )
}
