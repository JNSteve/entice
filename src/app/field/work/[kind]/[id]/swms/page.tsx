import { notFound, redirect } from 'next/navigation'
import { ShieldCheckIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { parseWorkKind } from '@/lib/live-work'
import { fetchMyFieldSwms } from '@/lib/swms-queries'
import { FieldSwmsCard } from '@/components/FieldSwmsCard'

export default async function WorkSwmsPage({
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
  const items = await fetchMyFieldSwms(supabase, profile.id, { kind, id })

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheckIcon className="size-5 shrink-0" />
        No SWMS has been issued to this job yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <FieldSwmsCard key={item.id} item={item} />
      ))}
    </div>
  )
}
