import { redirect } from 'next/navigation'

// The diary now lives on the project screen's Diary tab.
export default async function FieldDiaryRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { projectId } = await params
  const { date } = await searchParams
  const suffix = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''
  redirect(`/field/work/project/${projectId}/diary${suffix}`)
}
