import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { todayAU } from '@/lib/tz'
import type { CompetencyCategory, WorkerRole } from '@/lib/zod'
import {
  TrainingClient,
  type RecordRow,
  type RequirementRow,
  type TypeRow,
  type WorkerRow,
} from './training-client'

export default async function TrainingPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const [
    { data: workers },
    { data: types },
    { data: records },
    { data: requirements },
  ] = await Promise.all([
    supabase
      .from('workers')
      .select('id, profile_id, name, company, role, active')
      .order('name'),
    supabase
      .from('competency_types')
      .select('id, name, category, validity_months, is_system, active')
      .order('name'),
    supabase
      .from('competency_records')
      .select(
        `id, number, worker_id, competency_type_id, issuer, reference_no,
         issue_date, expiry_date, evidence_path, evidence_filename,
         superseded_by, created_at,
         creator:profiles!competency_records_created_by_fkey(full_name)`
      )
      .order('issue_date', { ascending: false }),
    supabase
      .from('role_competency_requirements')
      .select('id, role, competency_type_id, is_mandatory'),
  ])

  // Batch-sign the evidence files (private bucket, 1h links).
  const paths = (records ?? [])
    .map((r) => r.evidence_path as string | null)
    .filter((p): p is string => Boolean(p))
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const workerRows: WorkerRow[] = (workers ?? []).map((w) => ({
    id: w.id as string,
    profile_id: (w.profile_id as string | null) ?? null,
    name: w.name as string,
    company: (w.company as string | null) ?? null,
    role: w.role as WorkerRole,
    active: w.active as boolean,
  }))

  const typeRows: TypeRow[] = (types ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    category: t.category as CompetencyCategory,
    validity_months: (t.validity_months as number | null) ?? null,
    active: t.active as boolean,
  }))

  const recordRows: RecordRow[] = (records ?? []).map((r) => ({
    id: r.id as string,
    number: r.number as string,
    worker_id: r.worker_id as string,
    competency_type_id: r.competency_type_id as string,
    issuer: (r.issuer as string | null) ?? null,
    reference_no: (r.reference_no as string | null) ?? null,
    issue_date: r.issue_date as string,
    expiry_date: (r.expiry_date as string | null) ?? null,
    evidence_filename: (r.evidence_filename as string | null) ?? null,
    evidence_url: r.evidence_path
      ? urlByPath.get(r.evidence_path as string) ?? null
      : null,
    superseded_by: (r.superseded_by as string | null) ?? null,
    created_at: r.created_at as string,
    created_by_name:
      (r.creator as unknown as { full_name: string } | null)?.full_name ?? null,
  }))

  const requirementRows: RequirementRow[] = (requirements ?? []).map((r) => ({
    id: r.id as string,
    role: r.role as WorkerRole,
    competency_type_id: r.competency_type_id as string,
    is_mandatory: r.is_mandatory as boolean,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Training & competency"
        description="Licences, tickets, VOCs and inductions per worker with expiry traffic lights, the competency matrix and role requirements (ISO 7.2)."
      />
      <TrainingClient
        workers={workerRows}
        types={typeRows}
        records={recordRows}
        requirements={requirementRows}
        today={todayAU()}
        canManage={profile.role === 'admin' || profile.role === 'office'}
        isAdmin={profile.role === 'admin'}
      />
    </div>
  )
}
