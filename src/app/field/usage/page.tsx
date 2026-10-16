import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU, yesterdayAU } from '@/lib/tz'
import { Button } from '@/components/ui/button'
import { UsageClient, type PlantOption, type ScopeLine, type UsageRow } from './usage-client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function FieldUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; project?: string; date?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const jobId = sp.job && UUID_RE.test(sp.job) ? sp.job : null
  const projectId = sp.project && UUID_RE.test(sp.project) ? sp.project : null

  if ((jobId ? 1 : 0) + (projectId ? 1 : 0) !== 1) {
    return <PickWork />
  }

  const today = todayAU()
  const yesterday = yesterdayAU()
  const date = sp.date === yesterday ? yesterday : today

  const supabase = await createClient()

  const headerQuery = jobId
    ? supabase.from('jobs').select('number, title').eq('id', jobId).maybeSingle()
    : supabase.from('projects').select('number, name').eq('id', projectId!).maybeSingle()

  let usageQuery = supabase
    .from('field_usage')
    .select(
      'id, user_id, kind, description, qty, unit, company, headcount, hours, notes, quote_line_id, rate_item_id, plant_id, created_at, profiles!field_usage_user_id_fkey(full_name)'
    )
    .eq('date', date)
    .order('created_at', { ascending: true })
  usageQuery = jobId ? usageQuery.eq('job_id', jobId) : usageQuery.eq('project_id', projectId!)

  let noteQuery = supabase.from('field_day_notes').select('summary').eq('date', date)
  noteQuery = jobId ? noteQuery.eq('job_id', jobId) : noteQuery.eq('project_id', projectId!)

  const [{ data: header }, { data: options }, { data: usageRows }, { data: note }] =
    await Promise.all([
      headerQuery,
      supabase.rpc('field_usage_options', { p_job: jobId, p_project: projectId }),
      usageQuery,
      noteQuery.maybeSingle(),
    ])

  if (!header) return <PickWork />

  const h = header as { number: string; title?: string; name?: string }
  const label = `${h.number} — ${h.title ?? h.name ?? ''}`

  const opts = (options ?? {}) as { scope?: ScopeLine[]; plant?: PlantOption[] }

  const rows: UsageRow[] = (usageRows ?? []).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      kind: r.kind as UsageRow['kind'],
      description: r.description as string,
      qty: r.qty == null ? null : Number(r.qty),
      unit: (r.unit as string | null) ?? null,
      company: (r.company as string | null) ?? null,
      headcount: r.headcount == null ? null : Number(r.headcount),
      hours: r.hours == null ? null : Number(r.hours),
      notes: (r.notes as string | null) ?? null,
      quote_line_id: (r.quote_line_id as string | null) ?? null,
      rate_item_id: (r.rate_item_id as string | null) ?? null,
      plant_id: (r.plant_id as string | null) ?? null,
      created_at: r.created_at as string,
      logged_by: (p as { full_name?: string } | null)?.full_name ?? null,
    }
  })

  const param = jobId ? `job=${jobId}` : `project=${projectId}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/field"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon className="size-3.5" />
          My Day
        </Link>
        <div>
          <h1 className="text-lg font-bold leading-tight">Used today</h1>
          <p className="truncate text-sm text-muted-foreground">{label}</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
          <Link
            href={`/field/usage?${param}`}
            className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
              date === today ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            Today
          </Link>
          <Link
            href={`/field/usage?${param}&date=${yesterday}`}
            className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
              date === yesterday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            Yesterday
          </Link>
        </div>
      </div>

      <UsageClient
        key={date}
        jobId={jobId}
        projectId={projectId}
        date={date}
        dateLabel={date === today ? 'today' : 'yesterday'}
        scope={opts.scope ?? []}
        plant={opts.plant ?? []}
        rows={rows}
        summary={(note?.summary as string | undefined) ?? ''}
        currentUserId={profile.id}
      />
    </div>
  )
}

function PickWork() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm font-medium">Pick a job from My Day</p>
      <p className="text-sm text-muted-foreground">
        Open a job or project card and tap “Log materials &amp; plant”.
      </p>
      <Button render={<Link href="/field" />} variant="outline" size="sm">
        Back to My Day
      </Button>
    </div>
  )
}
