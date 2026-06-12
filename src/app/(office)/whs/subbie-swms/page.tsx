import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import type { SubbieSwmsStatus } from '@/lib/zod'
import {
  SubbieSwmsQueue,
  type SubbieSwmsRow,
  type VendorOption,
} from './queue-table'
import type { RequestProjectOption } from './request-dialog'

export default async function WhsSubbieSwmsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const [{ data: submissions }, { data: projects }, { data: vendors }, { data: auditRows }] =
    await Promise.all([
      supabase
        .from('subbie_swms')
        .select(
          `id, created_at, company_name, contact_name, email, title, file_path,
           status, review_notes, reviewed_at, project_id,
           projects(number, name),
           vendors(name),
           profiles!subbie_swms_reviewed_by_fkey(full_name)`
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('projects')
        .select('id, number, name')
        .eq('status', 'active')
        .order('number'),
      supabase
        .from('vendors')
        .select('id, name')
        .eq('archived', false)
        .order('name'),
      // The share link a submission came through is recorded on its
      // external_submission audit row (detail.label) by submit_subbie_swms.
      supabase
        .from('audit_log')
        .select('entity_id, detail')
        .eq('entity_type', 'subbie_swms')
        .eq('action', 'external_submission'),
    ])

  const linkLabelById = new Map<string, string>()
  for (const a of auditRows ?? []) {
    const label = (a.detail as { label?: string } | null)?.label
    if (label) linkLabelById.set(a.entity_id as string, label)
  }

  // Batch-sign the uploaded PDFs (anon has no read access — staff view goes
  // through short-lived signed URLs).
  const paths = (submissions ?? []).map((s) => s.file_path as string)
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const rows: SubbieSwmsRow[] = (submissions ?? []).map((s) => {
    const projectRel = s.projects as unknown as { number: string; name: string } | null
    const vendorRel = s.vendors as unknown as { name: string } | null
    const reviewerRel = s.profiles as unknown as { full_name: string } | null
    return {
      id: s.id as string,
      created_at: s.created_at as string,
      company_name: s.company_name as string,
      contact_name: s.contact_name as string,
      email: (s.email as string | null) ?? null,
      title: s.title as string,
      status: s.status as SubbieSwmsStatus,
      project_id: s.project_id as string,
      project_label: projectRel
        ? `${projectRel.number} — ${projectRel.name}`
        : '—',
      vendor_name: vendorRel?.name ?? null,
      review_notes: (s.review_notes as string | null) ?? null,
      reviewed_by_name: reviewerRel?.full_name ?? null,
      reviewed_at: (s.reviewed_at as string | null) ?? null,
      link_label: linkLabelById.get(s.id as string) ?? null,
      pdf_url: urlByPath.get(s.file_path as string) ?? null,
    }
  })

  const projectOptions: RequestProjectOption[] = (projects ?? []).map((p) => ({
    id: p.id as string,
    number: p.number as string,
    name: p.name as string,
  }))

  const vendorOptions: VendorOption[] = (vendors ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Subbie SWMS register"
        description="Request, collect and review subcontractor SWMS before they start on site."
      />
      <SubbieSwmsQueue
        rows={rows}
        projects={projectOptions}
        vendors={vendorOptions}
        canReview={profile.role === 'admin' || profile.role === 'office'}
      />
    </div>
  )
}
