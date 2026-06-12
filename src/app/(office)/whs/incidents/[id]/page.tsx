import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { ChevronLeftIcon } from 'lucide-react'
import {
  IncidentDetailClient,
  type IncidentDetailData,
  type CorrectiveActionRow,
  type ProjectOption,
  type JobOption,
  type ProfileOption,
} from './incident-detail'
import type { AttachmentItem } from '@/components/AttachmentList'
import type { IncidentType, IncidentStatus } from '@/lib/zod'

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: incident },
    { data: actions },
    { data: projects },
    { data: jobs },
    { data: profileRows },
  ] = await Promise.all([
    supabase
      .from('incidents')
      .select(
        `id, number, type, severity, occurred_at, location, description,
         immediate_action, reported_by, status, closed_at, project_id, job_id,
         projects(number, name),
         jobs(number, title),
         profiles!incidents_reported_by_fkey(full_name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('corrective_actions')
      .select(
        `id, incident_id, description, assigned_to, due_date, status, completed_at,
         profiles!corrective_actions_assigned_to_fkey(full_name)`
      )
      .eq('incident_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at'),
    supabase
      .from('projects')
      .select('id, number, name')
      .order('number'),
    supabase
      .from('jobs')
      .select('id, number, title')
      .in('status', ['scheduled', 'in_progress'])
      .order('number'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
  ])

  if (!incident) notFound()

  const project = incident.projects as unknown as {
    number: string
    name: string
  } | null
  const job = incident.jobs as unknown as {
    number: string
    title: string
  } | null

  const reporter = incident.profiles as unknown as { full_name: string } | null

  const incidentData: IncidentDetailData = {
    id: incident.id as string,
    number: incident.number as string,
    type: incident.type as IncidentType,
    severity: Number(incident.severity),
    occurred_at: incident.occurred_at as string,
    location: (incident.location as string | null) ?? null,
    description: incident.description as string,
    immediate_action: (incident.immediate_action as string | null) ?? null,
    reported_by: (incident.reported_by as string | null) ?? null,
    reported_by_name: reporter?.full_name ?? null,
    status: incident.status as IncidentStatus,
    closed_at: (incident.closed_at as string | null) ?? null,
    project_id: (incident.project_id as string | null) ?? null,
    project_label: project ? `${project.number} — ${project.name}` : null,
    job_id: (incident.job_id as string | null) ?? null,
    job_label: job ? `${job.number} — ${job.title}` : null,
  }

  const actionRows: CorrectiveActionRow[] = (actions ?? []).map((a) => {
    const assigneeProfile = a.profiles as unknown as { full_name: string } | null
    return {
      id: a.id as string,
      incident_id: a.incident_id as string,
      description: a.description as string,
      assigned_to: (a.assigned_to as string | null) ?? null,
      assigned_to_name: assigneeProfile?.full_name ?? null,
      due_date: (a.due_date as string | null) ?? null,
      status: a.status as string,
      completed_at: (a.completed_at as string | null) ?? null,
    }
  })

  const attachments = await fetchAttachmentsWithUrls(supabase, 'incident', id)
  const attachmentItems: AttachmentItem[] = attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    content_type: a.content_type,
    size: a.size,
    kind: a.kind,
    caption: a.caption,
    created_by: a.created_by,
    created_by_name: a.created_by_name,
    created_at: a.created_at,
    signedUrl: a.signedUrl,
  }))

  const projectOptions: ProjectOption[] = (projects ?? []).map((p) => ({
    id: p.id as string,
    number: p.number as string,
    name: p.name as string,
  }))

  const jobOptions: JobOption[] = (jobs ?? []).map((j) => ({
    id: j.id as string,
    number: j.number as string,
    title: j.title as string,
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/whs/incidents"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Incidents
      </Link>
      <IncidentDetailClient
        incident={incidentData}
        actions={actionRows}
        attachments={attachmentItems}
        role={profile.role}
        projects={projectOptions}
        jobs={jobOptions}
        profiles={profileOptions}
      />
    </div>
  )
}
