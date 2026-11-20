import { notFound, redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { parseWorkKind } from '@/lib/live-work'
import { fetchWorkHeader } from '@/lib/field-work-queries'
import { CaptureClient } from '@/app/field/photo/capture-client'

export default async function WorkPhotosPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const header = await fetchWorkHeader(supabase, kind, id)
  if (!header) notFound()

  return (
    <CaptureClient
      recentTargets={[]}
      allTargets={[]}
      today={todayAU()}
      fixedTarget={{ id, type: kind, number: header.number, label: header.title }}
    />
  )
}
