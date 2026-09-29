import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadPnl } from '@/lib/pnl-queries'
import { PnlPanel } from '@/components/pnl/PnlPanel'

export default async function ProjectPnlPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()
  const data = await loadPnl(supabase, 'project', id)
  if (!data) notFound()

  return (
    <PnlPanel
      parentType="project"
      parentId={id}
      data={data}
      variationsHref={`/projects/${id}/variations`}
    />
  )
}
