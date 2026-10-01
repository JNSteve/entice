import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { fmtDate } from '@/lib/format'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { fmtInstantAU } from '@/components/signoffs/SignoffRegister'
import type { SignoffSection } from '@/lib/signoffs'
import {
  SignoffEditor,
  type EditorLine,
  type EditorPhoto,
  type EditorResponse,
  type EditorVersion,
} from './signoff-editor'

type ClientRel = { name: string } | { name: string }[] | null
type JobRel = { id: string; number: string; title: string; client_id: string; clients: ClientRel }
type ProjectRel = { id: string; number: string; name: string; clients: ClientRel }
type NameRel = { full_name: string } | { full_name: string }[] | null

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default async function SignoffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const canEdit = profile.role === 'admin' || profile.role === 'office'
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const supabase = await createClient()

  const { data: signoffRaw } = await supabase
    .from('daily_signoffs')
    .select(
      `id, job_id, project_id, date, version, status, summary, photo_ids, built_at, released_at,
       jobs(id, number, title, client_id, clients(name)),
       projects(id, number, name, clients(name)),
       released_by_profile:profiles!daily_signoffs_released_by_fkey(full_name),
       built_by_profile:profiles!daily_signoffs_built_by_fkey(full_name)`
    )
    .eq('id', id)
    .maybeSingle()
  if (!signoffRaw) notFound()

  const signoff = signoffRaw as unknown as {
    id: string
    job_id: string | null
    project_id: string | null
    date: string
    version: number
    status: string
    summary: string
    photo_ids: string[] | null
    built_at: string
    released_at: string | null
    jobs: JobRel | JobRel[] | null
    projects: ProjectRel | ProjectRel[] | null
    released_by_profile: NameRel
    built_by_profile: NameRel
  }

  const kind: 'job' | 'project' = signoff.job_id ? 'job' : 'project'
  const workId = (signoff.job_id ?? signoff.project_id) as string
  const job = one(signoff.jobs)
  const project = one(signoff.projects)
  const workNumber = job?.number ?? project?.number ?? ''
  const workTitle = job?.title ?? project?.name ?? ''
  const clientName = one(job?.clients ?? project?.clients ?? null)?.name ?? null
  const workHref = kind === 'job' ? `/jobs/${workId}` : `/projects/${workId}/signoffs`
  const workCol = kind === 'job' ? 'job_id' : 'project_id'

  const [{ data: lineRows }, { data: responseRow }, { data: versionRows }, { data: diary }] =
    await Promise.all([
      supabase
        .from('daily_signoff_lines')
        .select('id, sort, section, description, qty, unit, detail, scope_label, flags')
        .eq('signoff_id', id)
        .order('sort')
        .order('id'),
      supabase
        .from('daily_signoff_responses')
        .select('signer_name, signature_data, disputes, signed_at, ip')
        .eq('signoff_id', id)
        .maybeSingle(),
      supabase
        .from('daily_signoffs')
        .select('id, version, status')
        .eq(workCol, workId)
        .eq('date', signoff.date)
        .order('version'),
      kind === 'project'
        ? supabase
            .from('diaries')
            .select('id')
            .eq('project_id', workId)
            .eq('date', signoff.date)
            .maybeSingle()
        : Promise.resolve({ data: null as { id: string } | null }),
    ])

  // Candidate photos: that day's photos on the work (and the project diary).
  const parentFilters = [`and(parent_type.eq.${kind},parent_id.eq.${workId})`]
  const diaryId = (diary as { id: string } | null)?.id
  if (diaryId) parentFilters.push(`and(parent_type.eq.diary,parent_id.eq.${diaryId})`)
  const selectedIds = signoff.photo_ids ?? []

  const [{ data: dayPhotos }, { data: selectedPhotos }] = await Promise.all([
    supabase
      .from('attachments')
      .select('id, path, filename, caption, created_at')
      .eq('kind', 'photo')
      .or(parentFilters.join(','))
      .gte('created_at', `${signoff.date}T00:00:00+10:00`)
      .lt('created_at', `${nextDay(signoff.date)}T00:00:00+10:00`)
      .order('created_at'),
    selectedIds.length > 0
      ? supabase
          .from('attachments')
          .select('id, path, filename, caption, created_at')
          .in('id', selectedIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  type PhotoRow = { id: string; path: string; filename: string; caption: string | null; created_at: string }
  const photoMap = new Map<string, PhotoRow>()
  for (const p of [...((dayPhotos ?? []) as PhotoRow[]), ...((selectedPhotos ?? []) as PhotoRow[])]) {
    photoMap.set(p.id, p)
  }
  const photoRows = [...photoMap.values()]
  const urlMap = new Map<string, string>()
  if (photoRows.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(
        photoRows.map((p) => p.path),
        3600
      )
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl)
    }
  }
  const photos: EditorPhoto[] = photoRows.map((p) => ({
    id: p.id,
    url: urlMap.get(p.path) ?? null,
    caption: p.caption ?? p.filename,
  }))

  const lines: EditorLine[] = (lineRows ?? []).map((l) => ({
    id: l.id as string,
    section: l.section as SignoffSection,
    description: l.description as string,
    qty: Number(l.qty),
    unit: (l.unit as string | null) ?? '',
    detail: (l.detail as string | null) ?? null,
    scope_label: (l.scope_label as string | null) ?? null,
    flags: (l.flags as string[] | null) ?? [],
  }))

  const resp = responseRow as {
    signer_name: string
    signature_data: string
    disputes: { line_id: string; client_qty: number; reason: string }[] | null
    signed_at: string
    ip: string | null
  } | null
  const response: EditorResponse | null = resp
    ? {
        signer_name: resp.signer_name,
        signature_data: resp.signature_data,
        signed_at: resp.signed_at,
        ip: resp.ip,
        disputes: Array.isArray(resp.disputes) ? resp.disputes : [],
      }
    : null

  const versions: EditorVersion[] = (versionRows ?? []).map((v) => ({
    id: v.id as string,
    version: Number(v.version),
    status: v.status as string,
  }))

  const builtBy = one(signoff.built_by_profile)?.full_name ?? 'overnight run'
  const releasedBy = one(signoff.released_by_profile)?.full_name ?? null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={workHref} className="text-sm text-muted-foreground hover:text-foreground">
          {`← ${workNumber} — ${workTitle}`}
        </Link>
        <PageHeader
          title={`Daily sign-off — ${workNumber}`}
          description={`${fmtDate(signoff.date)} · version ${signoff.version}${clientName ? ` · ${clientName}` : ''}`}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <SignoffStatusBadge status={signoff.status} />
          <span>{`Built ${fmtInstantAU(signoff.built_at)} by ${builtBy}`}</span>
          {signoff.released_at && (
            <span>
              {`Released ${fmtInstantAU(signoff.released_at)}${releasedBy ? ` by ${releasedBy}` : ''}`}
            </span>
          )}
        </div>
      </div>

      <SignoffEditor
        signoffId={signoff.id}
        kind={kind}
        workId={workId}
        date={signoff.date}
        status={signoff.status}
        canEdit={canEdit}
        summary={signoff.summary ?? ''}
        photoIds={selectedIds}
        photos={photos}
        lines={lines}
        response={response}
        versions={versions}
      />
    </div>
  )
}
