import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronRightIcon, TruckIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU, yesterdayAU } from '@/lib/tz'
import { parseWorkKind, workHref } from '@/lib/live-work'
import { fmtDuration, fmtTimeAU, hoursBetween } from '@/lib/field-today'
import {
  UsageClient,
  type PlantOption,
  type ScopeLine,
  type UsageRow,
} from '@/app/field/usage/usage-client'

export default async function WorkDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()
  const sp = await searchParams

  const jobId = kind === 'job' ? id : null
  const projectId = kind === 'project' ? id : null
  const col = kind === 'job' ? 'job_id' : 'project_id'

  const today = todayAU()
  const yesterday = yesterdayAU()
  const date = sp.date === yesterday ? yesterday : today

  const supabase = await createClient()

  const [{ data: options }, { data: usageRows }, { data: note }, { data: hourRows }] =
    await Promise.all([
      supabase.rpc('field_usage_options', { p_job: jobId, p_project: projectId }),
      supabase
        .from('field_usage')
        .select(
          'id, user_id, kind, description, qty, unit, company, headcount, hours, notes, quote_line_id, rate_item_id, plant_id, created_at, profiles!field_usage_user_id_fkey(full_name)'
        )
        .eq('date', date)
        .eq(col, id)
        .order('created_at', { ascending: true }),
      supabase.from('field_day_notes').select('summary').eq('date', date).eq(col, id).maybeSingle(),
      supabase
        .from('timesheet_entries')
        .select('id, start_at, end_at')
        .eq('user_id', profile.id)
        .eq('date', date)
        .eq(col, id)
        .order('start_at'),
    ])

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

  const now = new Date()
  const hours = (hourRows ?? []).map((h) => ({
    id: h.id as string,
    start: h.start_at as string,
    end: (h.end_at as string | null) ?? null,
    hours: hoursBetween(h.start_at as string, (h.end_at as string | null) ?? null, now),
  }))
  const totalHours = hours.reduce((sum, h) => sum + h.hours, 0)
  const base = workHref(kind, id, 'day')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
        <Link
          href={base}
          className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
            date === today ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          Today
        </Link>
        <Link
          href={`${base}?date=${yesterday}`}
          className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
            date === yesterday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          Yesterday
        </Link>
      </div>

      <section className="flex flex-col gap-1 rounded-xl border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Your hours</h2>
          <span className="text-sm font-medium tabular-nums">
            {hours.length > 0 ? fmtDuration(totalHours) : '—'}
          </span>
        </div>
        {hours.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No time on this job {date === today ? 'today' : 'yesterday'}. Check in on the
            Today tab.
          </p>
        ) : (
          hours.map((h) => (
            <p key={h.id} className="text-xs tabular-nums text-muted-foreground">
              {fmtTimeAU(h.start)} – {h.end ? fmtTimeAU(h.end) : 'now'} · {fmtDuration(h.hours)}
            </p>
          ))
        )}
      </section>

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

      <Link
        href={`/field/waste?${kind}=${id}`}
        className="flex items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/50 active:bg-muted"
      >
        <TruckIcon className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">Log waste load</span>
          <span className="text-xs text-muted-foreground">
            Waste or spoil leaving site — photograph the docket
          </span>
        </div>
        <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  )
}
