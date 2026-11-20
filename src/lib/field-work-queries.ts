// Server-side loaders for the field Jobs list and job screen. Use in Server
// Components and server actions only.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TodayStatus } from '@/lib/field-today'
import {
  LIVE_JOB_STATUSES,
  LIVE_PROJECT_STATUSES,
  isLiveWork,
  workKey,
  type LiveWorkRow,
  type WorkKind,
} from '@/lib/live-work'

/** Supabase returns a joined row as an object or a one-element array. */
function one<T>(rel: unknown): T | null {
  if (Array.isArray(rel)) return (rel[0] as T | undefined) ?? null
  return (rel as T | null) ?? null
}

type SiteRel = {
  name: string | null
  address?: string | null
  suburb: string | null
  state?: string | null
  postcode?: string | null
}

const WORK_COLUMN = { job: 'job_id', project: 'project_id' } as const

// ─── Jobs list ───────────────────────────────────────────────────────────────

export async function fetchLiveWork(supabase: SupabaseClient): Promise<LiveWorkRow[]> {
  const [{ data: jobs }, { data: projects }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, number, title, status, clients:client_id ( name ), sites:site_id ( name, address, suburb )')
      .eq('archived', false)
      .in('status', [...LIVE_JOB_STATUSES]),
    supabase
      .from('projects')
      .select('id, number, name, status, clients:client_id ( name ), sites:site_id ( name, address, suburb )')
      .eq('archived', false)
      .in('status', [...LIVE_PROJECT_STATUSES]),
  ])

  const siteLabel = (rel: unknown) => {
    const s = one<SiteRel>(rel)
    return [s?.name, s?.suburb].filter(Boolean).join(', ') || null
  }

  return [
    ...(jobs ?? []).map((j) => ({
      kind: 'job' as const,
      id: j.id as string,
      number: j.number as string,
      title: j.title as string,
      status: j.status as string,
      client: one<{ name: string }>(j.clients)?.name ?? null,
      site: siteLabel(j.sites),
      address: one<SiteRel>(j.sites)?.address ?? null,
    })),
    ...(projects ?? []).map((p) => ({
      kind: 'project' as const,
      id: p.id as string,
      number: p.number as string,
      title: p.name as string,
      status: p.status as string,
      client: one<{ name: string }>(p.clients)?.name ?? null,
      site: siteLabel(p.sites),
      address: one<SiteRel>(p.sites)?.address ?? null,
    })),
  ]
}

/** workKey() of everything the person is scheduled on for `date`. */
export async function fetchScheduledKeys(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<string[]> {
  const { data } = await supabase
    .from('assignments')
    .select('job_id, project_id')
    .eq('user_id', userId)
    .eq('date', date)

  const keys = new Set<string>()
  for (const a of data ?? []) {
    if (a.job_id) keys.add(workKey('job', a.job_id as string))
    else if (a.project_id) keys.add(workKey('project', a.project_id as string))
  }
  return [...keys]
}

export interface OpenWorkEntry {
  id: string
  startAt: string
  kind: WorkKind
  workId: string
  number: string
  title: string
}

/** The person's open timesheet entry (no finish time), if any. */
export async function fetchOpenEntry(
  supabase: SupabaseClient,
  userId: string
): Promise<OpenWorkEntry | null> {
  const { data } = await supabase
    .from('timesheet_entries')
    .select(
      'id, start_at, job_id, project_id, jobs:job_id ( number, title ), projects:project_id ( number, name )'
    )
    .eq('user_id', userId)
    .is('end_at', null)
    // Newest first + limit 1: nothing in the database enforces "one open
    // entry", and a bare maybeSingle() errors on two rows, which would read
    // as "not checked in".
    .order('start_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null

  const job = one<{ number: string; title: string }>(data.jobs)
  const project = one<{ number: string; name: string }>(data.projects)
  if (data.job_id && job) {
    return {
      id: data.id as string,
      startAt: data.start_at as string,
      kind: 'job',
      workId: data.job_id as string,
      number: job.number,
      title: job.title,
    }
  }
  if (data.project_id && project) {
    return {
      id: data.id as string,
      startAt: data.start_at as string,
      kind: 'project',
      workId: data.project_id as string,
      number: project.number,
      title: project.name,
    }
  }
  return null
}

// ─── Job screen ──────────────────────────────────────────────────────────────

export interface WorkHeader {
  kind: WorkKind
  id: string
  number: string
  title: string
  status: string
  live: boolean
  /** Address then site name, comma separated — what Maps should search for. */
  siteLabel: string | null
  contactPhone: string | null
}

export async function fetchWorkHeader(
  supabase: SupabaseClient,
  kind: WorkKind,
  id: string
): Promise<WorkHeader | null> {
  const rels =
    'sites:site_id ( name, address, suburb, state, postcode ), clients:client_id ( contacts ( phone ) )'
  const { data } =
    kind === 'job'
      ? await supabase
          .from('jobs')
          .select(`id, number, title, status, archived, ${rels}`)
          .eq('id', id)
          .maybeSingle()
      : await supabase
          .from('projects')
          .select(`id, number, name, status, archived, ${rels}`)
          .eq('id', id)
          .maybeSingle()
  if (!data) return null

  const row = data as Record<string, unknown>
  const site = one<SiteRel>(row.sites)
  const client = one<{ contacts: { phone: string | null }[] | null }>(row.clients)
  const address = [site?.address, site?.suburb, site?.state, site?.postcode]
    .filter(Boolean)
    .join(' ')
  const status = row.status as string

  return {
    kind,
    id,
    number: row.number as string,
    title: (kind === 'job' ? row.title : row.name) as string,
    status,
    live: isLiveWork(kind, status, Boolean(row.archived)),
    siteLabel: [address, site?.name].filter(Boolean).join(', ') || null,
    contactPhone: client?.contacts?.[0]?.phone ?? null,
  }
}

export type TodayData = TodayStatus & {
  /** Today's schedule note for this person on this work. */
  note: string | null
}

export async function fetchTodayStatus(
  supabase: SupabaseClient,
  args: { kind: WorkKind; id: string; userId: string; today: string }
): Promise<TodayData> {
  const { kind, id, userId, today } = args
  const col = WORK_COLUMN[kind]
  // Brisbane is fixed +10 — the AU day starts at T00:00:00+10:00.
  const dayStartIso = new Date(`${today}T00:00:00+10:00`).toISOString()

  const [meeting, swms, usage, diary, photos, assignment] = await Promise.all([
    supabase
      .from('form_submissions')
      .select('id, submitted_at')
      .eq('kind', 'prestart_meeting')
      .eq(col, id)
      .gte('submitted_at', dayStartIso)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('swms_instances').select('id, version').eq('status', 'active').eq(col, id),
    supabase
      .from('field_usage')
      .select('id', { count: 'exact', head: true })
      .eq(col, id)
      .eq('date', today),
    kind === 'project'
      ? supabase.from('diaries').select('id').eq('project_id', id).eq('date', today).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      .eq('parent_type', kind)
      .eq('parent_id', id)
      .eq('kind', 'photo')
      .gte('created_at', dayStartIso),
    supabase
      .from('assignments')
      .select('note')
      .eq('user_id', userId)
      .eq('date', today)
      .eq(col, id)
      .limit(1)
      .maybeSingle(),
  ])

  const instances = (swms.data ?? []) as { id: string; version: number }[]
  let swmsToSign = 0
  if (instances.length > 0) {
    const { data: sigs } = await supabase
      .from('swms_signatures')
      .select('swms_instance_id, version')
      .eq('user_id', userId)
      .in('swms_instance_id', instances.map((i) => i.id))
    const signed = new Map<string, number>()
    for (const s of sigs ?? []) {
      const key = s.swms_instance_id as string
      signed.set(key, Math.max(signed.get(key) ?? 0, Number(s.version)))
    }
    swmsToSign = instances.filter((i) => (signed.get(i.id) ?? 0) < Number(i.version)).length
  }

  return {
    prestartSubmittedAt: (meeting.data?.submitted_at as string | undefined) ?? null,
    swmsTotal: instances.length,
    swmsToSign,
    usageCount: usage.count ?? 0,
    diarySaved: kind === 'project' ? Boolean(diary.data) : null,
    photoCount: photos.count ?? 0,
    note: (assignment.data?.note as string | null | undefined) ?? null,
  }
}
