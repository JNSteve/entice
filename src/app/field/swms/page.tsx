import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRightIcon, ShieldCheckIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/EmptyState'

type SignState = 'signed' | 'resign' | 'needs'

type SwmsListItem = {
  id: string
  title: string
  version: number
  parentLabel: string
  state: SignState
}

function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function StateChip({ state, version }: { state: SignState; version: number }) {
  if (state === 'signed') {
    return (
      <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        Signed v{version}
      </span>
    )
  }
  if (state === 'resign') {
    return (
      <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        Re-sign required
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      Needs signature
    </span>
  )
}

function SwmsCard({ item }: { item: SwmsListItem }) {
  return (
    <Link
      href={`/field/swms/${item.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">
          {item.title}{' '}
          <span className="font-normal text-muted-foreground">v{item.version}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {item.parentLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StateChip state={item.state} version={item.version} />
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </div>
    </Link>
  )
}

export default async function FieldSwmsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  // Monday–Sunday of the current week (server local — acceptable v1).
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - daysFromMonday)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  const [{ data: assignments }, { data: instances }] = await Promise.all([
    supabase
      .from('assignments')
      .select('project_id, job_id')
      .eq('user_id', profile.id)
      .gte('date', localDateStr(weekStart))
      .lte('date', localDateStr(weekEnd)),
    supabase
      .from('swms_instances')
      .select(
        'id, title, version, status, project_id, job_id, created_at, projects(number, name), jobs(number, title)'
      )
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ])

  const mySignatures = (instances ?? []).length
    ? (
        await supabase
          .from('swms_signatures')
          .select('swms_instance_id, version')
          .eq('user_id', profile.id)
          .in(
            'swms_instance_id',
            (instances ?? []).map((i) => i.id as string)
          )
      ).data
    : []

  // Highest version I've signed per instance.
  const signedVersion = new Map<string, number>()
  for (const sig of mySignatures ?? []) {
    const key = sig.swms_instance_id as string
    const v = Number(sig.version)
    if ((signedVersion.get(key) ?? 0) < v) signedVersion.set(key, v)
  }

  const assignedProjects = new Set(
    (assignments ?? []).map((a) => a.project_id as string | null).filter(Boolean)
  )
  const assignedJobs = new Set(
    (assignments ?? []).map((a) => a.job_id as string | null).filter(Boolean)
  )

  const items: Array<SwmsListItem & { assigned: boolean }> = (instances ?? []).map(
    (i) => {
      const projectRel = i.projects as unknown as {
        number: string
        name: string
      } | null
      const jobRel = i.jobs as unknown as { number: string; title: string } | null
      const parentLabel = projectRel
        ? `${projectRel.number} — ${projectRel.name}`
        : jobRel
          ? `${jobRel.number} — ${jobRel.title}`
          : '—'

      const myVersion = signedVersion.get(i.id as string) ?? 0
      const state: SignState =
        myVersion >= Number(i.version)
          ? 'signed'
          : myVersion > 0
            ? 'resign'
            : 'needs'

      return {
        id: i.id as string,
        title: i.title as string,
        version: Number(i.version),
        parentLabel,
        state,
        assigned:
          (i.project_id != null && assignedProjects.has(i.project_id as string)) ||
          (i.job_id != null && assignedJobs.has(i.job_id as string)),
      }
    }
  )

  const assigned = items.filter((i) => i.assigned)
  const others = items.filter((i) => !i.assigned)

  // Group the rest by project/job label.
  const groups = new Map<string, SwmsListItem[]>()
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
                  <SwmsCard key={item.id} item={item} />
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
                    <SwmsCard key={item.id} item={item} />
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
