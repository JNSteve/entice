import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { SignoffRegister } from '@/components/signoffs/SignoffRegister'

export default async function ProjectSignoffsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id').eq('id', id).maybeSingle()
  if (!project) notFound()

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Daily sign-offs</h2>
      <SignoffRegister
        kind="project"
        workId={id}
        canManage={profile.role === 'admin' || profile.role === 'office'}
      />
    </section>
  )
}
