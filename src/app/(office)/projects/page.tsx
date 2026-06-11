import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { round2 } from '@/lib/money'
import { ProjectsTable, type ProjectRow } from './projects-table'
import { NewProjectDialog } from './new-project-dialog'

export default async function ProjectsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const showMoney = profile.role === 'admin' || profile.role === 'office'

  const supabase = await createClient()

  // Money relations (variations/claims) are admin/office only — RLS would
  // return nothing for a supervisor, so don't even ask for them.
  const projectSelect = showMoney
    ? `id, number, name, status, contract_sum,
       clients(id, name),
       variations(status, sell_amount),
       claims(status, total_claimed_to_date)`
    : `id, number, name, status, clients(id, name)`

  const projectsQuery = supabase
    .from('projects')
    .select(projectSelect)
    .order('created_at', { ascending: false })

  const [{ data: projects }, { data: clients }, { data: sites }, { data: supervisors }] =
    await Promise.all([
      projectsQuery,
      showMoney
        ? supabase.from('clients').select('id, name').eq('archived', false).order('name')
        : Promise.resolve({ data: null }),
      showMoney
        ? supabase.from('sites').select('id, client_id, name').order('name')
        : Promise.resolve({ data: null }),
      showMoney
        ? supabase
            .from('profiles')
            .select('id, full_name')
            .in('role', ['admin', 'office', 'supervisor'])
            .eq('active', true)
            .order('full_name')
        : Promise.resolve({ data: null }),
    ])

  type ProjectRecord = {
    id: string
    number: string
    name: string
    status: string
    contract_sum?: number
    clients: { id: string; name: string } | null
    variations?: { status: string; sell_amount: number }[]
    claims?: { status: string; total_claimed_to_date: number | null }[]
  }

  const rows: ProjectRow[] = ((projects ?? []) as unknown as ProjectRecord[]).map(
    (p) => {
      let adjustedSum: number | null = null
      let claimedToDate: number | null = null

      if (showMoney) {
        const approvedVos = (p.variations ?? [])
          .filter((v) => v.status === 'approved')
          .reduce((s, v) => s + Number(v.sell_amount), 0)
        adjustedSum = round2(Number(p.contract_sum ?? 0) + approvedVos)

        const claimed = (p.claims ?? [])
          .filter((c) => c.status !== 'draft' && c.total_claimed_to_date != null)
          .map((c) => Number(c.total_claimed_to_date))
        claimedToDate = claimed.length > 0 ? Math.max(...claimed) : 0
      }

      return {
        id: p.id,
        number: p.number,
        name: p.name,
        client_name: p.clients?.name ?? '—',
        status: p.status,
        adjusted_sum: adjustedSum,
        claimed_to_date: claimedToDate,
      }
    }
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Head-contract projects with budgets, claims and retention."
        actions={
          showMoney ? (
            <NewProjectDialog
              clients={clients ?? []}
              sites={(sites ?? []).map((s) => ({
                id: s.id,
                name: s.name,
                client_id: s.client_id,
              }))}
              supervisors={supervisors ?? []}
            />
          ) : undefined
        }
      />
      <ProjectsTable rows={rows} showMoney={showMoney} canCreate={showMoney} />
    </div>
  )
}
