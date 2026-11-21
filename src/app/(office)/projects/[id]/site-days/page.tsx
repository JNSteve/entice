import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { SiteDaysRecent } from '@/components/site-days/SiteDaysRecent'

export default async function ProjectSiteDaysPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id').eq('id', id).maybeSingle()
  if (!project) notFound()

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Site days</h2>
      <SiteDaysRecent kind="project" workId={id} />
    </section>
  )
}
