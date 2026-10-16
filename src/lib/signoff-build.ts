// Daily sign-off snapshots — loading the day's source rows and writing the
// frozen draft. Takes any Supabase client: the PM's session client (admin /
// office pass RLS) or the service-role client in the overnight cron.
//
// Server-only (imports node:crypto through signoff-hash).

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSnapshotLines, type TimesheetSource, type UsageSource } from '@/lib/signoffs'
import { sourceHash } from '@/lib/signoff-hash'
import { yesterdayAU } from '@/lib/tz'

export type WorkRef = { kind: 'job' | 'project'; id: string }

const parentColumn = (work: WorkRef) => (work.kind === 'job' ? 'job_id' : 'project_id')

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

export async function loadSnapshotSource(
  sb: SupabaseClient,
  work: WorkRef,
  date: string
): Promise<{ timesheets: TimesheetSource[]; usage: UsageSource[]; summary: string }> {
  const col = parentColumn(work)

  const [{ data: entries, error: tErr }, { data: usageRows, error: uErr }, { data: note }, diary] =
    await Promise.all([
      sb
        .from('timesheet_entries')
        .select('id, user_id, start_at, end_at, approved, profiles!timesheet_entries_user_id_fkey(full_name)')
        .eq(col, work.id)
        .eq('date', date),
      sb
        .from('field_usage')
        .select(
          'id, kind, description, qty, unit, company, headcount, hours, updated_at, created_at, quote_lines(description)'
        )
        .eq(col, work.id)
        .eq('date', date)
        .order('created_at')
        .order('id'),
      sb.from('field_day_notes').select('summary').eq(col, work.id).eq('date', date).maybeSingle(),
      work.kind === 'project'
        ? sb
            .from('diaries')
            .select('work_performed')
            .eq('project_id', work.id)
            .eq('date', date)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
  if (tErr) throw new Error(tErr.message)
  if (uErr) throw new Error(uErr.message)

  const timesheets: TimesheetSource[] = (entries ?? []).map((e) => ({
    id: e.id as string,
    user_id: e.user_id as string,
    full_name: one(e.profiles as { full_name: string } | { full_name: string }[] | null)?.full_name ?? 'Unknown',
    start_at: e.start_at as string,
    end_at: (e.end_at as string | null) ?? null,
    approved: Boolean(e.approved),
  }))

  const usage: UsageSource[] = (usageRows ?? []).map((u) => ({
    id: u.id as string,
    kind: u.kind as UsageSource['kind'],
    description: u.description as string,
    qty: u.qty === null ? null : Number(u.qty),
    unit: (u.unit as string | null) ?? null,
    company: (u.company as string | null) ?? null,
    headcount: u.headcount === null ? null : Number(u.headcount),
    hours: u.hours === null ? null : Number(u.hours),
    // quote_lines.description is unbounded; the snapshot column caps at 500.
    scope_label:
      one(u.quote_lines as { description: string } | { description: string }[] | null)?.description?.slice(0, 500) ??
      null,
    updated_at: u.updated_at as string,
  }))

  const diaryText = ((diary.data as { work_performed: string | null } | null)?.work_performed ?? '').trim()
  const noteText = ((note as { summary: string } | null)?.summary ?? '').trim()

  return { timesheets, usage, summary: diaryText || noteText }
}

export async function currentSourceHash(
  sb: SupabaseClient,
  work: WorkRef,
  date: string
): Promise<string> {
  const { timesheets, usage } = await loadSnapshotSource(sb, work, date)
  return sourceHash({ timesheets, usage })
}

/**
 * Build (or rebuild) the draft for one work-day.
 *   * no sign-off yet          → v1 draft
 *   * latest is a draft        → lines/summary/hash replaced in place
 *   * latest released / signed → refused (it is a record now)
 *   * latest disputed          → refused (the PM revises instead)
 */
export async function buildSignoffDraft(
  sb: SupabaseClient,
  work: WorkRef,
  date: string,
  builtBy: string | null
): Promise<{ id: string } | { error: string }> {
  const col = parentColumn(work)

  const { data: existing, error: exErr } = await sb
    .from('daily_signoffs')
    .select('id, status, version, supersedes_id')
    .eq(col, work.id)
    .eq('date', date)
    .order('version', { ascending: false })
    .limit(1)
  if (exErr) return { error: exErr.message }
  const latest = existing?.[0] as
    | { id: string; status: string; version: number; supersedes_id: string | null }
    | undefined

  if (latest && (latest.status === 'released' || latest.status === 'signed')) {
    return { error: 'This day has already been released to the client' }
  }
  if (latest && latest.status === 'disputed') {
    return { error: 'The client disputed this day — open it and use Revise' }
  }
  if (latest && latest.status === 'draft' && latest.supersedes_id) {
    // Rebuilding would drop the client's agreed figures carried into the
    // revision — edit its lines directly instead.
    return { error: 'This is a revision — edit its lines directly rather than rebuilding' }
  }

  let source: Awaited<ReturnType<typeof loadSnapshotSource>>
  try {
    source = await loadSnapshotSource(sb, work, date)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the day' }
  }

  const lines = buildSnapshotLines({ timesheets: source.timesheets, usage: source.usage })
  if (lines.length === 0) {
    return { error: 'Nothing was logged for this day (no time on site or usage)' }
  }
  const hash = sourceHash({ timesheets: source.timesheets, usage: source.usage })

  let signoffId: string
  if (latest && latest.status === 'draft') {
    signoffId = latest.id
    const { error: upErr } = await sb
      .from('daily_signoffs')
      .update({
        summary: source.summary,
        source_hash: hash,
        built_at: new Date().toISOString(),
        built_by: builtBy,
      })
      .eq('id', signoffId)
      .eq('status', 'draft')
    if (upErr) return { error: upErr.message }
  } else {
    const { data: created, error: insErr } = await sb
      .from('daily_signoffs')
      .insert({
        [col]: work.id,
        date,
        version: 1,
        status: 'draft',
        summary: source.summary,
        source_hash: hash,
        built_by: builtBy,
      })
      .select('id')
      .single()
    if (insErr || !created) {
      return {
        error:
          insErr?.code === '23505'
            ? 'A sign-off for this day already exists — refresh the page'
            : (insErr?.message ?? 'Could not create the sign-off'),
      }
    }
    signoffId = created.id as string
  }

  // New lines go in before the old ones come out, so a failed insert never
  // leaves an empty draft.
  const { data: inserted, error: linesErr } = await sb
    .from('daily_signoff_lines')
    .insert(lines.map((l) => ({ ...l, signoff_id: signoffId })))
    .select('id')
  if (linesErr) return { error: linesErr.message }
  const keep = (inserted ?? []).map((r) => r.id as string)
  if (keep.length > 0) {
    const { error: delErr } = await sb
      .from('daily_signoff_lines')
      .delete()
      .eq('signoff_id', signoffId)
      .not('id', 'in', `(${keep.join(',')})`)
    if (delErr) return { error: delErr.message }
  }

  return { id: signoffId }
}

/**
 * Overnight run (6 am Brisbane via /api/cron/notify): a draft for every
 * job/project that had time on site or usage logged yesterday and has no
 * sign-off for that day yet. Nothing is sent to anyone.
 */
export async function buildYesterdayDrafts(
  admin: SupabaseClient,
  date: string = yesterdayAU()
): Promise<{ date: string; built: number; skipped: number; errors: string[] }> {
  const [{ data: entries }, { data: usage }, { data: existing }] = await Promise.all([
    admin.from('timesheet_entries').select('job_id, project_id').eq('date', date),
    admin.from('field_usage').select('job_id, project_id').eq('date', date),
    admin.from('daily_signoffs').select('job_id, project_id').eq('date', date),
  ])

  const key = (r: { job_id: string | null; project_id: string | null }) =>
    r.job_id ? `job:${r.job_id}` : r.project_id ? `project:${r.project_id}` : null

  const done = new Set(
    ((existing ?? []) as { job_id: string | null; project_id: string | null }[]).map(key)
  )
  const works = new Map<string, WorkRef>()
  for (const r of [...(entries ?? []), ...(usage ?? [])] as {
    job_id: string | null
    project_id: string | null
  }[]) {
    const k = key(r)
    if (!k || works.has(k)) continue
    works.set(k, r.job_id ? { kind: 'job', id: r.job_id } : { kind: 'project', id: r.project_id! })
  }

  let built = 0
  let skipped = 0
  const errors: string[] = []
  for (const [k, work] of works) {
    if (done.has(k)) {
      skipped++
      continue
    }
    const result = await buildSignoffDraft(admin, work, date, null)
    if ('error' in result) errors.push(`${k}: ${result.error}`)
    else built++
  }
  return { date, built, skipped, errors }
}
