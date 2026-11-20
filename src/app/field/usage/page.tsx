import { redirect } from 'next/navigation'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The materials and plant log now lives on the job screen's Day sheet tab.
// Old links (bookmarks, the pre-redesign My Day button) land here.
export default async function FieldUsageRedirect({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; project?: string; date?: string }>
}) {
  const sp = await searchParams
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? `?date=${sp.date}` : ''
  if (sp.job && UUID_RE.test(sp.job)) redirect(`/field/work/job/${sp.job}/day${date}`)
  if (sp.project && UUID_RE.test(sp.project)) {
    redirect(`/field/work/project/${sp.project}/day${date}`)
  }
  redirect('/field/jobs')
}
