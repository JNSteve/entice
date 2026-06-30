import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { fetchAuditFor } from '@/lib/audit-queries'
import { ChevronLeftIcon } from 'lucide-react'
import {
  NcrDetailClient,
  type NcrDetailData,
  type CapaActionRow,
  type ProjectOption,
  type JobOption,
  type VendorOption,
  type ProfileOption,
} from './ncr-detail'
import type { AttachmentItem } from '@/components/AttachmentList'
import type { AuditRow } from '@/lib/audit-queries'
import type { NcrSource, NcrStatus, CapaKind } from '@/lib/zod'

export default async function NcrDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: ncr },
    { data: actions },
    { data: projects },
    { data: jobs },
    { data: vendors },
    { data: profileRows },
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('ncrs')
      .select(
        `id, number, source, category, severity, title, description,
         immediate_action, root_cause, status, occurred_on, raised_by,
         verification_notes, verified_by, verified_at, closed_at,
         project_id, job_id, vendor_id, incident_id,
         projects(number, name),
         jobs(number, title),
         vendors(name),
         incidents(number),
         raiser:profiles!ncrs_raised_by_fkey(full_name),
         verifier:profiles!ncrs_verified_by_fkey(full_name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('capa_actions')
      .select(
        `id, ncr_id, kind, description, assigned_to, due_date, status, completed_at,
         profiles!capa_actions_assigned_to_fkey(full_name)`
      )
      .eq('ncr_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at'),
    supabase.from('projects').select('id, number, name').order('number'),
    supabase
      .from('jobs')
      .select('id, number, title')
      .in('status', ['scheduled', 'in_progress'])
      .order('number'),
    supabase.from('vendors').select('id, name').order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
    fetchAuditFor(supabase, 'ncrs', id),
  ])

  if (!ncr) notFound()

  const project = ncr.projects as unknown as {
    number: string
    name: string
  } | null
  const job = ncr.jobs as unknown as { number: string; title: string } | null
  const vendor = ncr.vendors as unknown as { name: string } | null
  const incident = ncr.incidents as unknown as { number: string } | null
  const raiser = ncr.raiser as unknown as { full_name: string } | null
  const verifier = ncr.verifier as unknown as { full_name: string } | null

  const ncrData: NcrDetailData = {
    id: ncr.id as string,
    number: ncr.number as string,
    source: ncr.source as NcrSource,
    category: (ncr.category as string | null) ?? null,
    severity: Number(ncr.severity),
    title: ncr.title as string,
    description: ncr.description as string,
    immediate_action: (ncr.immediate_action as string | null) ?? null,
    root_cause: (ncr.root_cause as string | null) ?? null,
    status: ncr.status as NcrStatus,
    occurred_on: (ncr.occurred_on as string | null) ?? null,
    raised_by_name: raiser?.full_name ?? null,
    verification_notes: (ncr.verification_notes as string | null) ?? null,
    verified_by_name: verifier?.full_name ?? null,
    verified_at: (ncr.verified_at as string | null) ?? null,
    closed_at: (ncr.closed_at as string | null) ?? null,
    project_id: (ncr.project_id as string | null) ?? null,
    project_label: project ? `${project.number} — ${project.name}` : null,
    job_id: (ncr.job_id as string | null) ?? null,
    job_label: job ? `${job.number} — ${job.title}` : null,
    vendor_id: (ncr.vendor_id as string | null) ?? null,
    vendor_label: vendor?.name ?? null,
    incident_id: (ncr.incident_id as string | null) ?? null,
    incident_number: incident?.number ?? null,
  }

  const actionRows: CapaActionRow[] = (actions ?? []).map((a) => {
    const assigneeProfile = a.profiles as unknown as {
      full_name: string
    } | null
    return {
      id: a.id as string,
      ncr_id: a.ncr_id as string,
      kind: a.kind as CapaKind,
      description: a.description as string,
      assigned_to: (a.assigned_to as string | null) ?? null,
      assigned_to_name: assigneeProfile?.full_name ?? null,
      due_date: (a.due_date as string | null) ?? null,
      status: a.status as string,
      completed_at: (a.completed_at as string | null) ?? null,
    }
  })

  const attachments = await fetchAttachmentsWithUrls(supabase, 'ncr', id)
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

  const vendorOptions: VendorOption[] = (vendors ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/whs/ncr"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        NCR / CAPA
      </Link>
      <NcrDetailClient
        ncr={ncrData}
        actions={actionRows}
        attachments={attachmentItems}
        role={profile.role}
        projects={projectOptions}
        jobs={jobOptions}
        vendors={vendorOptions}
        profiles={profileOptions}
        auditHistory={auditHistory as AuditRow[]}
      />
    </div>
  )
}
