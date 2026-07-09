import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { docTotals } from '@/lib/money'
import { cn } from '@/lib/utils'
import { JobsTable, type JobRow } from './jobs-table'
import { NewJobDialog } from './new-job-dialog'

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'quote', label: 'Quote' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
  { value: 'lost', label: 'Lost' },
] as const

type StatusFilter = (typeof STATUS_TABS)[number]['value']

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; pm?: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { status, pm } = await searchParams
  const filter: StatusFilter = STATUS_TABS.some((t) => t.value === status)
    ? (status as StatusFilter)
    : 'all'
  const mine = pm === 'me'

  const supabase = await createClient()

  let jobsQuery = supabase
    .from('jobs')
    .select(
      `id, number, title, status, scheduled_start, scheduled_end,
       clients(id, name),
       sites(id, name),
       supervisor:profiles!jobs_supervisor_id_fkey(id, full_name),
       pm:profiles!jobs_pm_id_fkey(id, full_name),
       quotes(id, gst_rate, quote_lines(qty, unit_sell))`
    )
    .order('created_at', { ascending: false })

  if (filter !== 'all') jobsQuery = jobsQuery.eq('status', filter)
  if (mine) jobsQuery = jobsQuery.eq('pm_id', profile.id)

  const [{ data: jobs }, { data: clients }, { data: sites }, { data: supervisors }, { data: pms }] =
    await Promise.all([
      jobsQuery,
      supabase.from('clients').select('id, name').eq('archived', false).order('name'),
      supabase.from('sites').select('id, client_id, name').order('name'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['admin', 'office', 'supervisor'])
        .eq('active', true)
        .order('full_name'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['admin', 'office'])
        .eq('active', true)
        .order('full_name'),
    ])

  const rows: JobRow[] = (jobs ?? []).map((j) => {
    const clientRel = j.clients as unknown as { id: string; name: string } | null
    const siteRel = j.sites as unknown as { id: string; name: string } | null
    const supervisorRel = j.supervisor as unknown as { id: string; full_name: string } | null
    const pmRel = j.pm as unknown as { id: string; full_name: string } | null
    const quoteRel = j.quotes as unknown as {
      id: string
      gst_rate: number
      quote_lines: { qty: number; unit_sell: number }[]
    } | null

    let quotedValue: number | null = null
    if (quoteRel?.quote_lines) {
      const lines = quoteRel.quote_lines.map((l) => ({
        qty: Number(l.qty),
        unitSell: Number(l.unit_sell),
      }))
      quotedValue = docTotals(lines, Number(quoteRel.gst_rate)).subtotal
    }

    return {
      id: j.id,
      number: j.number,
      title: j.title,
      client_name: clientRel?.name ?? '—',
      site_name: siteRel?.name ?? null,
      status: j.status,
      supervisor_name: supervisorRel?.full_name ?? null,
      pm_name: pmRel?.full_name ?? null,
      scheduled_start: j.scheduled_start ?? null,
      scheduled_end: j.scheduled_end ?? null,
      quoted_value: quotedValue,
    }
  })

  const canCreate = profile.role === 'admin' || profile.role === 'office'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Manage and track jobs."
        actions={
          canCreate ? (
            <NewJobDialog
              clients={clients ?? []}
              sites={(sites ?? []).map((s) => ({ id: s.id, name: s.name, client_id: s.client_id }))}
              supervisors={supervisors ?? []}
              pms={pms ?? []}
            />
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1 flex-wrap">
          {STATUS_TABS.map((t) => {
            const params = new URLSearchParams()
            if (t.value !== 'all') params.set('status', t.value)
            if (mine) params.set('pm', 'me')
            const qs = params.toString()
            return (
              <Link
                key={t.value}
                href={qs ? `/jobs?${qs}` : '/jobs'}
                className={cn(
                  'rounded-md px-3 py-1 text-sm transition-colors',
                  filter === t.value
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
              </Link>
            )
          })}
        </div>
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1 flex-wrap">
          {(() => {
            const params = new URLSearchParams()
            if (filter !== 'all') params.set('status', filter)
            if (!mine) params.set('pm', 'me')
            const qs = params.toString()
            return (
              <Link
                href={qs ? `/jobs?${qs}` : '/jobs'}
                className={cn(
                  'rounded-md px-3 py-1 text-sm transition-colors',
                  mine
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Mine
              </Link>
            )
          })()}
        </div>
      </div>
      <JobsTable rows={rows} filtered={filter !== 'all'} />
    </div>
  )
}
