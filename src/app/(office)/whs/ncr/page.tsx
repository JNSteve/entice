import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { PageHeader } from '@/components/PageHeader'
import {
  NcrTable,
  type NcrRow,
  type ProjectOption,
  type JobOption,
  type VendorOption,
} from './ncr-table'
import type { NcrSource } from '@/lib/zod'

export default async function WhsNcrPage() {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const today = todayAU()

  const [
    { data: ncrs },
    { data: projects },
    { data: jobs },
    { data: vendors },
    { data: capas },
  ] = await Promise.all([
    supabase
      .from('ncrs')
      .select(
        `id, number, classification, source, source_detail, title, description,
         status, occurred_on, created_at, assigned_to_text, due_date,
         implemented, verification_notes, closed_at, project_id`
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, number, name')
      .eq('archived', false)
      .eq('status', 'active')
      .order('number'),
    supabase
      .from('jobs')
      .select('id, number, title')
      .eq('archived', false)
      .in('status', ['scheduled', 'in_progress'])
      .order('number'),
    supabase.from('vendors').select('id, name').order('name'),
    supabase.from('capa_actions').select('ncr_id, status, due_date'),
  ])

  // CAPA count lookup
  const capasByNcr = new Map<string, { open: number; overdue: number }>()
  for (const c of capas ?? []) {
    const ncrId = c.ncr_id as string
    const entry = capasByNcr.get(ncrId) ?? { open: 0, overdue: 0 }
    if (c.status === 'open') {
      entry.open++
      if (c.due_date && (c.due_date as string) < today) entry.overdue++
    }
    capasByNcr.set(ncrId, entry)
  }

  const rows: NcrRow[] = (ncrs ?? []).map((n) => {
    const counts = capasByNcr.get(n.id as string) ?? { open: 0, overdue: 0 }
    const closedAt = (n.closed_at as string | null) ?? null
    return {
      id: n.id as string,
      number: n.number as string,
      classification: (n.classification as string | null) ?? null,
      // Date raised = occurred_on; field reports leave it blank, so fall back
      // to the Brisbane day the record was entered.
      raised_on:
        (n.occurred_on as string | null) ??
        todayAU(new Date(n.created_at as string)),
      source: n.source as NcrSource,
      source_detail: (n.source_detail as string | null) ?? null,
      title: n.title as string,
      description: n.description as string,
      assigned_to_text: (n.assigned_to_text as string | null) ?? null,
      due_date: (n.due_date as string | null) ?? null,
      implemented: (n.implemented as string | null) ?? null,
      verification_notes: (n.verification_notes as string | null) ?? null,
      status: n.status as string,
      closed_on: closedAt ? todayAU(new Date(closedAt)) : null,
      project_id: (n.project_id as string | null) ?? null,
      open_capa_count: counts.open,
      overdue_capa_count: counts.overdue,
    }
  })

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Corrective actions"
        description="SMS-R-08 register · closed by the Director (Compliance and Technical) (SMS-05)"
      />
      <NcrTable
        ncrs={rows}
        today={today}
        projects={projectOptions}
        jobs={jobOptions}
        vendors={vendorOptions}
      />
    </div>
  )
}
