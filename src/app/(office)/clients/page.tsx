import { requireRole, getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { ClientsTable } from './clients-table'
import { NewClientDialog } from './client-dialogs'

export default async function ClientsPage() {
  await requireRole('admin', 'office', 'supervisor')
  const profile = await getProfile()

  const supabase = await createClient()

  // Fetch non-archived clients with related counts
  const { data: clients } = await supabase
    .from('clients')
    .select(
      'id, name, type, payment_terms_days, sites(count), quotes(count), jobs(count), projects(count)'
    )
    .eq('archived', false)
    .order('name')

  // Fetch first site suburb per client
  const { data: firstSites } = await supabase
    .from('sites')
    .select('client_id, suburb')
    .order('created_at', { ascending: true })

  // Build a map of client_id -> first suburb
  const suburbMap: Record<string, string | null> = {}
  if (firstSites) {
    for (const site of firstSites) {
      if (!(site.client_id in suburbMap)) {
        suburbMap[site.client_id] = site.suburb
      }
    }
  }

  const rows = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    first_suburb: suburbMap[c.id] ?? null,
    payment_terms_days: c.payment_terms_days ?? 30,
    sites_count: (c.sites as unknown as { count: number }[])?.[0]?.count ?? 0,
    quotes_count: (c.quotes as unknown as { count: number }[])?.[0]?.count ?? 0,
    jobs_count: (c.jobs as unknown as { count: number }[])?.[0]?.count ?? 0,
    projects_count: (c.projects as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))

  const canCreate = profile?.role === 'admin' || profile?.role === 'office'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description="Manage your clients, contacts and sites."
        actions={canCreate ? <NewClientDialog /> : undefined}
      />
      <ClientsTable rows={rows} />
    </div>
  )
}
