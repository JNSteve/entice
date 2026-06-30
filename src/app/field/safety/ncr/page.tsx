import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NcrRaiseForm, type TargetOption } from './ncr-raise-form'

export default async function FieldRaiseNcrPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const supabase = await createClient()

  const { data: projectRows } = await supabase
    .from('projects')
    .select('id, number, name')
    .neq('status', 'closed')
    .order('number')

  const projects: TargetOption[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    label: `${p.number} — ${p.name}`,
  }))

  const defaultProjectId =
    sp.project && projects.some((p) => p.id === sp.project) ? sp.project : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/safety"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Safety
        </Link>
        <h1 className="text-lg font-bold">Report a problem (NCR)</h1>
        <p className="text-sm text-muted-foreground">
          Report a quality, environmental or other nonconformance. The office
          reviews and assigns the corrective action.
        </p>
      </div>

      <NcrRaiseForm projects={projects} defaultProjectId={defaultProjectId} />
    </div>
  )
}
