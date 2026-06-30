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
        `id, number, source, severity, title, status, occurred_on, created_at,
         raised_by, project_id, job_id, vendor_id,
         projects(number, name),
         jobs(number, title),
         vendors(name),
         profiles!ncrs_raised_by_fkey(full_name)`
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, number, name')
      .eq('status', 'active')
      .order('number'),
    supabase
      .from('jobs')
      .select('id, number, title')
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
    const project = n.projects as unknown as {
      number: string
      name: string
    } | null
    const job = n.jobs as unknown as { number: string; title: string } | null
    const vendor = n.vendors as unknown as { name: string } | null
    const raiser = n.profiles as unknown as { full_name: string } | null
    const counts = capasByNcr.get(n.id as string) ?? { open: 0, overdue: 0 }
    return {
      id: n.id as string,
      number: n.number as string,
      source: n.source as NcrSource,
      severity: Number(n.severity),
      title: n.title as string,
      status: n.status as string,
      raised_by_name: raiser?.full_name ?? null,
      occurred_on: (n.occurred_on as string | null) ?? null,
      created_at: n.created_at as string,
      project_id: (n.project_id as string | null) ?? null,
      project_label: project ? `${project.number} — ${project.name}` : null,
      job_id: (n.job_id as string | null) ?? null,
      job_label: job ? `${job.number} — ${job.title}` : null,
      vendor_label: vendor?.name ?? null,
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
        title="NCR / CAPA register"
        description="Nonconformances and corrective/preventive actions — driven to verified close (ISO 9001/14001 §10.2)."
      />
      <NcrTable
        ncrs={rows}
        projects={projectOptions}
        jobs={jobOptions}
        vendors={vendorOptions}
      />
    </div>
  )
}
