// Office "Site days" — server loaders. They take the caller's Supabase client
// so RLS applies; admin, office and supervisor can read every table used.
//
// Server-only. Client components import their row types from
// src/lib/site-days.ts, never from this file.
//
// No money: timesheet_entries.cost_rate is never selected here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { FORM_KIND_LABELS } from '@/lib/form-kinds'
import { todayAU } from '@/lib/tz'
import type { FormTemplateKind } from '@/lib/zod'
import {
  attentionReasons,
  compareDayRows,
  dayBoundsAU,
  summariseHours,
  type AttentionReason,
  type CrewEntry,
  type HoursEntry,
  type HoursSummary,
  type UsageLine,
  type WorkKind,
} from '@/lib/site-days'

// ─── Shared helpers ──────────────────────────────────────────────────────────

type ParentCols = { job_id: string | null; project_id: string | null }

const parentColumn = (kind: WorkKind) => (kind === 'job' ? 'job_id' : 'project_id')

function workKey(r: ParentCols): string | null {
  if (r.job_id) return `job:${r.job_id}`
  if (r.project_id) return `project:${r.project_id}`
  return null
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

type SignoffRef = { id: string; status: string }

// ─── Day list ────────────────────────────────────────────────────────────────

export type DayListRow = {
  kind: WorkKind
  id: string
  number: string
  title: string
  client: string | null
  hours: HoursSummary
  /** ISO instant of the day's pre-start meeting; null when there is none. */
  prestartAt: string | null
  usageCount: number
  photoCount: number
  signoff: SignoffRef | null
  attention: AttentionReason[]
}

type Acc = {
  kind: WorkKind
  id: string
  entries: HoursEntry[]
  prestartAt: string | null
  usageCount: number
  photoCount: number
  signoff: SignoffRef | null
}

/**
 * Every job and project with any field activity on `date`: hours, materials
 * log, a form, a photo or docket, a waste load, or a diary entry.
 */
export async function loadDayList(sb: SupabaseClient, date: string): Promise<DayListRow[]> {
  const { startIso, endIso } = dayBoundsAU(date)

  const [entries, usage, forms, files, signoffs, waste, diaries] = await Promise.all([
    sb
      .from('timesheet_entries')
      .select('user_id, job_id, project_id, start_at, end_at, approved')
      .eq('date', date),
    sb.from('field_usage').select('job_id, project_id').eq('date', date),
    sb
      .from('form_submissions')
      .select('kind, job_id, project_id, submitted_at')
      .gte('submitted_at', startIso)
      .lt('submitted_at', endIso)
      .order('submitted_at'),
    sb
      .from('attachments')
      .select('parent_type, parent_id')
      .in('parent_type', ['job', 'project'])
      .in('kind', ['photo', 'docket'])
      .gte('created_at', startIso)
      .lt('created_at', endIso),
    sb
      .from('daily_signoffs')
      .select('id, job_id, project_id, status, version')
      .eq('date', date)
      .order('version', { ascending: true }),
    sb.from('waste_loads').select('job_id, project_id').eq('date', date),
    sb.from('diaries').select('project_id').eq('date', date),
  ])

  const acc = new Map<string, Acc>()
  const touch = (r: ParentCols): Acc | null => {
    const key = workKey(r)
    if (!key) return null
    let a = acc.get(key)
    if (!a) {
      a = {
        kind: r.job_id ? 'job' : 'project',
        id: (r.job_id ?? r.project_id) as string,
        entries: [],
        prestartAt: null,
        usageCount: 0,
        photoCount: 0,
        signoff: null,
      }
      acc.set(key, a)
    }
    return a
  }

  for (const e of entries.data ?? []) {
    touch(e as ParentCols)?.entries.push({
      userId: e.user_id as string,
      startAt: e.start_at as string,
      endAt: (e.end_at as string | null) ?? null,
      approved: Boolean(e.approved),
    })
  }
  for (const u of usage.data ?? []) {
    const a = touch(u as ParentCols)
    if (a) a.usageCount++
  }
  for (const f of forms.data ?? []) {
    const a = touch(f as ParentCols)
    // Ordered by time, so the last pre-start meeting of the day wins.
    if (a && f.kind === 'prestart_meeting') a.prestartAt = f.submitted_at as string
  }
  for (const f of files.data ?? []) {
    const parent: ParentCols =
      f.parent_type === 'job'
        ? { job_id: f.parent_id as string, project_id: null }
        : { job_id: null, project_id: f.parent_id as string }
    const a = touch(parent)
    if (a) a.photoCount++
  }
  for (const s of signoffs.data ?? []) {
    const a = touch(s as ParentCols)
    // Ordered by version ascending, so the latest version wins.
    if (a) a.signoff = { id: s.id as string, status: s.status as string }
  }
  for (const w of waste.data ?? []) touch(w as ParentCols)
  for (const d of diaries.data ?? []) touch({ job_id: null, project_id: d.project_id as string })

  const jobIds = [...acc.values()].filter((a) => a.kind === 'job').map((a) => a.id)
  const projectIds = [...acc.values()].filter((a) => a.kind === 'project').map((a) => a.id)

  const [jobs, projects] = await Promise.all([
    jobIds.length > 0
      ? sb.from('jobs').select('id, number, title, clients(name)').in('id', jobIds)
      : Promise.resolve({ data: [] as never[] }),
    projectIds.length > 0
      ? sb.from('projects').select('id, number, name, clients(name)').in('id', projectIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const names = new Map<string, { number: string; title: string; client: string | null }>()
  for (const j of jobs.data ?? []) {
    names.set(`job:${j.id}`, {
      number: j.number as string,
      title: j.title as string,
      client: one(j.clients as unknown as { name: string } | { name: string }[] | null)?.name ?? null,
    })
  }
  for (const p of projects.data ?? []) {
    names.set(`project:${p.id}`, {
      number: p.number as string,
      title: p.name as string,
      client: one(p.clients as unknown as { name: string } | { name: string }[] | null)?.name ?? null,
    })
  }

  const today = todayAU()
  const rows: DayListRow[] = []
  for (const [key, a] of acc) {
    const name = names.get(key)
    if (!name) continue // the job or project no longer exists
    const hours = summariseHours(a.entries)
    rows.push({
      kind: a.kind,
      id: a.id,
      number: name.number,
      title: name.title,
      client: name.client,
      hours,
      prestartAt: a.prestartAt,
      usageCount: a.usageCount,
      photoCount: a.photoCount,
      signoff: a.signoff,
      attention: attentionReasons({ date, today, hours, prestartDone: a.prestartAt !== null }),
    })
  }
  return rows.sort(compareDayRows)
}

// ─── Recent days for one job or project ──────────────────────────────────────

export type RecentDay = {
  date: string
  hours: HoursSummary
  usageCount: number
  signoff: SignoffRef | null
}

/** The most recent days on which this work had hours or a materials-log line. */
export async function loadRecentDays(
  sb: SupabaseClient,
  kind: WorkKind,
  id: string,
  limit = 14
): Promise<RecentDay[]> {
  const col = parentColumn(kind)
  const [entries, usage, signoffs] = await Promise.all([
    sb
      .from('timesheet_entries')
      .select('date, user_id, start_at, end_at, approved')
      .eq(col, id)
      .order('date', { ascending: false })
      .limit(1000),
    sb
      .from('field_usage')
      .select('date')
      .eq(col, id)
      .order('date', { ascending: false })
      .limit(1000),
    sb
      .from('daily_signoffs')
      .select('id, date, status, version')
      .eq(col, id)
      .order('version', { ascending: true }),
  ])

  const byDate = new Map<string, { entries: HoursEntry[]; usageCount: number }>()
  const day = (date: string) => {
    let d = byDate.get(date)
    if (!d) {
      d = { entries: [], usageCount: 0 }
      byDate.set(date, d)
    }
    return d
  }
  for (const e of entries.data ?? []) {
    day(e.date as string).entries.push({
      userId: e.user_id as string,
      startAt: e.start_at as string,
      endAt: (e.end_at as string | null) ?? null,
      approved: Boolean(e.approved),
    })
  }
  for (const u of usage.data ?? []) day(u.date as string).usageCount++

  const signoffByDate = new Map<string, SignoffRef>()
  for (const s of signoffs.data ?? []) {
    signoffByDate.set(s.date as string, { id: s.id as string, status: s.status as string })
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, limit)
    .map(([date, d]) => ({
      date,
      hours: summariseHours(d.entries),
      usageCount: d.usageCount,
      signoff: signoffByDate.get(date) ?? null,
    }))
}

// ─── One job-day in full ─────────────────────────────────────────────────────

export type DayDetail = {
  work: { kind: WorkKind; id: string; number: string; title: string; client: string | null }
  date: string
  entries: CrewEntry[]
  /** Active people, for the "Add entry" picker. */
  people: { id: string; name: string }[]
  prestart: { id: string; submittedAt: string; submittedBy: string; signons: string[] } | null
  otherForms: { id: string; name: string; kindLabel: string; submittedAt: string; submittedBy: string }[]
  swms: { id: string; title: string; version: number; unsigned: string[] }[]
  usage: UsageLine[]
  summary: string
  signoff: { id: string; status: string; version: number } | null
  diary: { weather: string | null; workPerformed: string | null; delays: string | null } | null
  files: { id: string; kind: 'photo' | 'docket'; filename: string; signedUrl: string | null }[]
  wasteLoads: { id: string; number: string; classification: string; qty: number; unit: string }[]
  /** Nearest earlier / later day with hours or a materials-log line. */
  prevDate: string | null
  nextDate: string | null
}

type NameRel = { full_name: string } | { full_name: string }[] | null

export async function loadDayDetail(
  sb: SupabaseClient,
  kind: WorkKind,
  id: string,
  date: string
): Promise<DayDetail | null> {
  const col = parentColumn(kind)
  const { startIso, endIso } = dayBoundsAU(date)

  const workQuery =
    kind === 'job'
      ? sb.from('jobs').select('id, number, title, clients(name)').eq('id', id).maybeSingle()
      : sb.from('projects').select('id, number, name, clients(name)').eq('id', id).maybeSingle()

  const [
    work,
    entries,
    people,
    forms,
    swmsInstances,
    usage,
    note,
    signoff,
    diary,
    attachments,
    waste,
    entryDates,
    usageDates,
  ] = await Promise.all([
    workQuery,
    sb
      .from('timesheet_entries')
      .select(
        'id, user_id, start_at, end_at, approved, assignment_id, profiles!timesheet_entries_user_id_fkey(full_name)'
      )
      .eq(col, id)
      .eq('date', date)
      .order('start_at'),
    sb.from('profiles').select('id, full_name').eq('active', true).order('full_name'),
    sb
      .from('form_submissions')
      .select(
        `id, kind, submitted_at, amends,
         form_templates(name),
         profiles!form_submissions_submitted_by_fkey(full_name),
         form_signons(name)`
      )
      .eq(col, id)
      .gte('submitted_at', startIso)
      .lt('submitted_at', endIso)
      .order('submitted_at'),
    sb
      .from('swms_instances')
      .select('id, title, version')
      .eq(col, id)
      .eq('status', 'active')
      .order('title'),
    sb
      .from('field_usage')
      .select(
        'id, kind, description, qty, unit, company, headcount, hours, created_at, profiles!field_usage_user_id_fkey(full_name)'
      )
      .eq(col, id)
      .eq('date', date)
      .order('created_at')
      .order('id'),
    sb.from('field_day_notes').select('summary').eq(col, id).eq('date', date).maybeSingle(),
    sb
      .from('daily_signoffs')
      .select('id, status, version')
      .eq(col, id)
      .eq('date', date)
      .order('version', { ascending: false })
      .limit(1),
    kind === 'project'
      ? sb
          .from('diaries')
          .select('weather, work_performed, delays')
          .eq('project_id', id)
          .eq('date', date)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fetchAttachmentsWithUrls(sb, kind, id),
    sb
      .from('waste_loads')
      .select('id, number, classification, qty, unit')
      .eq(col, id)
      .eq('date', date)
      .order('created_at'),
    sb.from('timesheet_entries').select('date').eq(col, id).limit(2000),
    sb.from('field_usage').select('date').eq(col, id).limit(2000),
  ])

  if (!work.data) return null
  const w = work.data as { id: string; number: string; title?: string; name?: string; clients: unknown }

  const crew: CrewEntry[] = (entries.data ?? []).map((e) => ({
    id: e.id as string,
    userId: e.user_id as string,
    name: one(e.profiles as unknown as NameRel)?.full_name ?? 'Unknown',
    startAt: e.start_at as string,
    endAt: (e.end_at as string | null) ?? null,
    approved: Boolean(e.approved),
    unscheduled: e.assignment_id == null,
  }))

  // A submission that a later one amends is hidden; the amendment stands.
  const formRows = forms.data ?? []
  const amended = new Set(formRows.map((f) => f.amends as string | null).filter(Boolean) as string[])
  const visible = formRows.filter((f) => !amended.has(f.id as string))
  const shapeForm = (f: (typeof formRows)[number]) => ({
    id: f.id as string,
    name: one(f.form_templates as unknown as { name: string } | { name: string }[] | null)?.name ?? 'Form',
    kindLabel: FORM_KIND_LABELS[f.kind as FormTemplateKind] ?? (f.kind as string),
    submittedAt: f.submitted_at as string,
    submittedBy: one(f.profiles as unknown as NameRel)?.full_name ?? 'Unknown',
  })
  const prestartRow = visible.filter((f) => f.kind === 'prestart_meeting').at(-1) ?? null
  const prestart = prestartRow
    ? {
        id: prestartRow.id as string,
        submittedAt: prestartRow.submitted_at as string,
        submittedBy: shapeForm(prestartRow).submittedBy,
        signons: ((prestartRow.form_signons as unknown as { name: string }[] | null) ?? []).map(
          (s) => s.name
        ),
      }
    : null
  const otherForms = visible.filter((f) => f.id !== prestartRow?.id).map(shapeForm)

  // SWMS: who of the day's crew has not signed the current version.
  const instances = (swmsInstances.data ?? []) as { id: string; title: string; version: number }[]
  const { data: signatures } =
    instances.length > 0
      ? await sb
          .from('swms_signatures')
          .select('swms_instance_id, user_id, version')
          .in(
            'swms_instance_id',
            instances.map((i) => i.id)
          )
      : { data: [] as never[] }
  const signedVersion = new Map<string, number>()
  for (const s of signatures ?? []) {
    if (!s.user_id) continue // external signer
    const key = `${s.swms_instance_id}:${s.user_id}`
    const v = Number(s.version)
    if ((signedVersion.get(key) ?? 0) < v) signedVersion.set(key, v)
  }
  const crewPeople = new Map<string, string>()
  for (const e of crew) crewPeople.set(e.userId, e.name)
  const swms = instances.map((i) => ({
    id: i.id,
    title: i.title,
    version: Number(i.version),
    unsigned: [...crewPeople.entries()]
      .filter(([userId]) => (signedVersion.get(`${i.id}:${userId}`) ?? 0) < Number(i.version))
      .map(([, name]) => name)
      .sort(),
  }))

  const usageLines: UsageLine[] = (usage.data ?? []).map((u) => ({
    id: u.id as string,
    kind: u.kind as UsageLine['kind'],
    description: u.description as string,
    qty: u.qty === null ? null : Number(u.qty),
    unit: (u.unit as string | null) ?? null,
    company: (u.company as string | null) ?? null,
    headcount: u.headcount === null ? null : Number(u.headcount),
    hours: u.hours === null ? null : Number(u.hours),
    loggedBy: one(u.profiles as unknown as NameRel)?.full_name ?? null,
  }))

  const latest = (signoff.data ?? [])[0] as { id: string; status: string; version: number } | undefined
  const d = diary.data as { weather: string | null; work_performed: string | null; delays: string | null } | null

  // created_at comes back as '…+00:00', startIso as '…Z' — compare instants,
  // never the strings.
  const startMs = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  const files = attachments
    .filter((a) => {
      if (a.kind !== 'photo' && a.kind !== 'docket') return false
      const t = new Date(a.created_at).getTime()
      return t >= startMs && t < endMs
    })
    .map((a) => ({
      id: a.id,
      kind: a.kind as 'photo' | 'docket',
      filename: a.filename,
      signedUrl: a.signedUrl,
    }))

  const activity = [
    ...new Set([
      ...(entryDates.data ?? []).map((r) => r.date as string),
      ...(usageDates.data ?? []).map((r) => r.date as string),
    ]),
  ].sort()
  const prevDate = activity.filter((x) => x < date).at(-1) ?? null
  const nextDate = activity.find((x) => x > date) ?? null

  return {
    work: {
      kind,
      id: w.id,
      number: w.number,
      title: (w.title ?? w.name ?? '') as string,
      client: one(w.clients as { name: string } | { name: string }[] | null)?.name ?? null,
    },
    date,
    entries: crew,
    people: (people.data ?? []).map((p) => ({ id: p.id as string, name: p.full_name as string })),
    prestart,
    otherForms,
    swms,
    usage: usageLines,
    summary: ((note.data as { summary: string } | null)?.summary ?? '').trim(),
    signoff: latest ? { id: latest.id, status: latest.status, version: Number(latest.version) } : null,
    diary: d ? { weather: d.weather, workPerformed: d.work_performed, delays: d.delays } : null,
    files,
    wasteLoads: (waste.data ?? []).map((l) => ({
      id: l.id as string,
      number: l.number as string,
      classification: l.classification as string,
      qty: Number(l.qty),
      unit: l.unit as string,
    })),
    prevDate,
    nextDate,
  }
}
