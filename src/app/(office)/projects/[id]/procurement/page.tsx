import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PackagesTable, type PackageRow, type CostCodeOption, type OwnerOption } from './packages-table'
import { NewPackageButton } from './new-package-button'

export default async function ProjectProcurementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: packages },
    { data: costCodes },
    { data: owners },
  ] = await Promise.all([
    supabase.from('projects').select('id').eq('id', id).single(),
    supabase
      .from('packages')
      .select(
        'id, name, status, budget_amount, cost_code_id, owner_id, let_by_date, notes, cost_codes(code, name), profiles(full_name)'
      )
      .eq('project_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('cost_codes')
      .select('id, code, name')
      .eq('active', true)
      .order('code'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .in('role', ['admin', 'office'])
      .eq('active', true)
      .order('full_name'),
  ])

  if (!project) notFound()

  // Fetch awarded amounts from commitments (status = active, grouped by package_id)
  const packageIds = (packages ?? []).map((p) => p.id)
  let awardedMap: Record<string, number> = {}

  if (packageIds.length > 0) {
    const { data: commitments } = await supabase
      .from('commitments')
      .select('package_id, amount')
      .in('package_id', packageIds)
      .eq('status', 'active')

    awardedMap = (commitments ?? []).reduce<Record<string, number>>((acc, c) => {
      if (c.package_id) {
        acc[c.package_id] = (acc[c.package_id] ?? 0) + Number(c.amount)
      }
      return acc
    }, {})
  }

  type RawPackage = {
    id: string
    name: string
    status: string
    budget_amount: number
    cost_code_id: string | null
    owner_id: string | null
    let_by_date: string | null
    notes: string | null
    cost_codes: { code: string; name: string } | null
    profiles: { full_name: string } | null
  }

  const rows: PackageRow[] = ((packages ?? []) as unknown as RawPackage[]).map((p) => {
    const cc = p.cost_codes
    const owner = p.profiles
    const awarded = p.status === 'awarded' ? (awardedMap[p.id] ?? null) : null
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      budget_amount: Number(p.budget_amount),
      awarded_amount: awarded,
      cost_code_id: p.cost_code_id ?? null,
      cost_code_code: cc?.code ?? null,
      cost_code_name: cc?.name ?? null,
      owner_id: p.owner_id ?? null,
      owner_name: owner?.full_name ?? null,
      let_by_date: p.let_by_date ?? null,
      notes: p.notes ?? null,
    }
  })

  const costCodeOptions: CostCodeOption[] = (costCodes ?? []).map((cc) => ({
    id: cc.id,
    code: cc.code,
    name: cc.name,
  }))

  const ownerOptions: OwnerOption[] = (owners ?? []).map((o) => ({
    id: o.id,
    full_name: o.full_name,
  }))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Procurement schedule</h2>
        <NewPackageButton
          projectId={id}
          costCodes={costCodeOptions}
          owners={ownerOptions}
        />
      </div>
      <PackagesTable
        projectId={id}
        packages={rows}
        costCodes={costCodeOptions}
        owners={ownerOptions}
      />
    </section>
  )
}
