import { redirect } from 'next/navigation'
import { ShieldCheckIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchMyFieldSwms, type FieldSwmsItem } from '@/lib/swms-queries'
import { FieldSwmsCard } from '@/components/FieldSwmsCard'
import { EmptyState } from '@/components/EmptyState'

export default async function FieldSwmsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const items = await fetchMyFieldSwms(supabase, profile.id)

  const assigned = items.filter((i) => i.assigned)
  const others = items.filter((i) => !i.assigned)

  // Group the rest by project/job label.
  const groups = new Map<string, FieldSwmsItem[]>()
  for (const item of others) {
    const list = groups.get(item.parentLabel) ?? []
    list.push(item)
    groups.set(item.parentLabel, list)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">SWMS</h1>
        <p className="text-sm text-muted-foreground">
          Read each safe work method statement and sign on before starting work.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheckIcon className="size-8" />}
          title="No active SWMS"
          description="SWMS issued to your projects and jobs will show up here."
        />
      ) : (
        <>
          {assigned.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                My sites this week
              </h2>
              <div className="flex flex-col gap-2">
                {assigned.map((item) => (
                  <FieldSwmsCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section className="flex flex-col gap-3">
              {assigned.length > 0 && (
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Other active SWMS
                </h2>
              )}
              {[...groups.entries()].map(([label, groupItems]) => (
                <div key={label} className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  {groupItems.map((item) => (
                    <FieldSwmsCard key={item.id} item={item} />
                  ))}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
