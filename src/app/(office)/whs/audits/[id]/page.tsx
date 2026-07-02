import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAuditFor } from '@/lib/audit-queries'
import { ChevronLeftIcon } from 'lucide-react'
import {
  AuditDetailClient,
  type AuditDetailData,
  type FindingRow,
  type ChecklistData,
} from './audit-detail'
import type {
  AreaOption,
  ProfileOption,
  TemplateOption,
} from '../audits-table'
import type { AuditRow as AuditLogRow } from '@/lib/audit-queries'
import type {
  AuditStandard,
  AuditStatus,
  FindingClassification,
  FormField,
  NcrStatus,
} from '@/lib/zod'

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: audit },
    { data: findings },
    { data: areas },
    { data: profileRows },
    { data: templates },
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('audits')
      .select(
        `id, number, programme_id, area_id, standards, auditor_id, auditee,
         planned_date, conducted_date, status, summary, closed_at, created_at,
         checklist_template_id, checklist_submission_id,
         audit_programmes(year, title, status),
         audit_areas(name),
         auditor:profiles!audits_auditor_id_fkey(full_name),
         checklist_template:form_templates(name, schema),
         checklist_submission:form_submissions(id, data, schema_snapshot, submitted_at,
           submitter:profiles!form_submissions_submitted_by_fkey(full_name))`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('audit_findings')
      .select(
        `id, audit_id, classification, description, clause_ref, status,
         ncr_id, closed_at, created_at,
         ncrs(number, status),
         raiser:profiles!audit_findings_raised_by_fkey(full_name)`
      )
      .eq('audit_id', id)
      .order('created_at'),
    supabase.from('audit_areas').select('id, name').eq('active', true).order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
    supabase
      .from('form_templates')
      .select('id, name')
      .eq('kind', 'audit')
      .eq('active', true)
      .order('name'),
    fetchAuditFor(supabase, 'audits', id),
  ])

  if (!audit) notFound()

  const programme = audit.audit_programmes as unknown as {
    year: string
    title: string
    status: string
  } | null
  const area = audit.audit_areas as unknown as { name: string } | null
  const auditor = audit.auditor as unknown as { full_name: string } | null
  const template = audit.checklist_template as unknown as {
    name: string
    schema: FormField[]
  } | null
  const submission = audit.checklist_submission as unknown as {
    id: string
    data: Record<string, unknown>
    schema_snapshot: FormField[] | null
    submitted_at: string
    submitter: { full_name: string } | null
  } | null

  const auditData: AuditDetailData = {
    id: audit.id as string,
    number: audit.number as string,
    programme_year: programme?.year ?? '—',
    programme_title: programme?.title ?? null,
    area_id: audit.area_id as string,
    area_name: area?.name ?? '—',
    standards: (audit.standards as AuditStandard[]) ?? [],
    auditor_id: (audit.auditor_id as string | null) ?? null,
    auditor_name: auditor?.full_name ?? null,
    auditee: (audit.auditee as string | null) ?? null,
    planned_date: (audit.planned_date as string | null) ?? null,
    conducted_date: (audit.conducted_date as string | null) ?? null,
    status: audit.status as AuditStatus,
    summary: (audit.summary as string | null) ?? null,
    closed_at: (audit.closed_at as string | null) ?? null,
    checklist_template_id: (audit.checklist_template_id as string | null) ?? null,
    checklist_template_name: template?.name ?? null,
    checklist_submission_id: (audit.checklist_submission_id as string | null) ?? null,
  }

  const checklist: ChecklistData = {
    // Fields to fill when conducting (the template's CURRENT schema).
    templateSchema: template?.schema ?? [],
    // Conducted answers, rendered against the snapshot captured at submit time.
    submission: submission
      ? {
          id: submission.id,
          data: submission.data ?? {},
          schema: submission.schema_snapshot ?? template?.schema ?? [],
          submitted_at: submission.submitted_at,
          submitted_by_name: submission.submitter?.full_name ?? null,
        }
      : null,
  }

  const findingRows: FindingRow[] = (findings ?? []).map((f) => {
    const ncr = f.ncrs as unknown as { number: string; status: string } | null
    const raiser = f.raiser as unknown as { full_name: string } | null
    return {
      id: f.id as string,
      audit_id: f.audit_id as string,
      classification: f.classification as FindingClassification,
      description: f.description as string,
      clause_ref: (f.clause_ref as string | null) ?? null,
      status: f.status as 'open' | 'closed',
      ncr_id: (f.ncr_id as string | null) ?? null,
      ncr_number: ncr?.number ?? null,
      ncr_status: (ncr?.status as NcrStatus | undefined) ?? null,
      raised_by_name: raiser?.full_name ?? null,
      closed_at: (f.closed_at as string | null) ?? null,
      created_at: f.created_at as string,
    }
  })

  const areaOptions: AreaOption[] = (areas ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }))
  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))
  const templateOptions: TemplateOption[] = (templates ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/whs/audits"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Audits
      </Link>
      <AuditDetailClient
        audit={auditData}
        checklist={checklist}
        findings={findingRows}
        areas={areaOptions}
        profiles={profileOptions}
        templates={templateOptions}
        role={profile.role}
        profileId={profile.id}
        auditHistory={auditHistory as AuditLogRow[]}
      />
    </div>
  )
}
