import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import { QuotesTable, type QuoteRow } from './quotes-table'
import { NewQuoteDialog } from './new-quote-dialog'

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'lost', label: 'Lost' },
] as const

type StatusFilter = (typeof STATUS_TABS)[number]['value']

function ageInDays(createdAt: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
  )
}

function buildHref(status: StatusFilter, mine: boolean): string {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (mine) params.set('pm', 'me')
  const qs = params.toString()
  return qs ? `/quotes?${qs}` : '/quotes'
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; pm?: string }>
}) {
  const profile = await requireRole('admin', 'office')

  const { status, pm } = await searchParams
  const filter: StatusFilter = STATUS_TABS.some((t) => t.value === status)
    ? (status as StatusFilter)
    : 'all'
  const mine = pm === 'me'

  const supabase = await createClient()

  let quotesQuery = supabase
    .from('quotes')
    .select(
      'id, number, title, status, gst_rate, sent_at, created_at, clients(name), profiles!quotes_pm_id_fkey(id, full_name), quote_lines(qty, unit_cost, unit_sell)'
    )
    .order('created_at', { ascending: false })
  if (filter !== 'all') quotesQuery = quotesQuery.eq('status', filter)
  if (mine) quotesQuery = quotesQuery.eq('pm_id', profile.id)

  const [
    { data: quotes },
    { data: clients },
    { data: sites },
    { data: contacts },
    { data: pmOptions },
  ] = await Promise.all([
    quotesQuery,
    supabase.from('clients').select('id, name').eq('archived', false).order('name'),
    supabase.from('sites').select('id, client_id, name').order('name'),
    supabase.from('contacts').select('id, client_id, name').order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .in('role', ['admin', 'office'])
      .eq('active', true)
      .order('full_name'),
  ])

  const rows: QuoteRow[] = (quotes ?? []).map((q) => {
    const lines = (q.quote_lines ?? []).map((l) => ({
      qty: Number(l.qty),
      unitSell: Number(l.unit_sell),
      unitCost: Number(l.unit_cost),
    }))
    const { subtotal } = docTotals(lines, Number(q.gst_rate))
    const cost = round2(lines.reduce((s, l) => s + lineTotal(l.qty, l.unitCost), 0))
    const marginPct = subtotal > 0 ? round2(((subtotal - cost) / subtotal) * 100) : 0

    return {
      id: q.id,
      number: q.number,
      client_name: (q.clients as unknown as { name: string } | null)?.name ?? '—',
      pm_name:
        (q.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
      title: q.title,
      status: q.status,
      total_sell: subtotal,
      margin_pct: marginPct,
      age_days: ageInDays(q.created_at),
      sent_at: q.sent_at,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        description="Build, send and track quotes."
        actions={
          <NewQuoteDialog
            clients={clients ?? []}
            sites={sites ?? []}
            contacts={contacts ?? []}
            pmOptions={pmOptions ?? []}
            currentProfileId={profile.id}
          />
        }
      />
      <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.value}
            href={buildHref(t.value, mine)}
            className={cn(
              'rounded-md px-3 py-1 text-sm transition-colors',
              filter === t.value
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        ))}
        <Link
          href={buildHref(filter, !mine)}
          className={cn(
            'rounded-md px-3 py-1 text-sm transition-colors',
            mine
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Mine
        </Link>
      </div>
      <QuotesTable rows={rows} filtered={filter !== 'all' || mine} />
    </div>
  )
}
