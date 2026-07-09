'use client'

import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, fmtDate, pct } from '@/lib/format'
import { FileTextIcon } from 'lucide-react'

export interface QuoteRow {
  id: string
  number: string
  client_name: string
  pm_name: string | null
  title: string
  status: string
  total_sell: number
  margin_pct: number
  age_days: number
  sent_at: string | null
}

export function QuotesTable({
  rows,
  filtered,
}: {
  rows: QuoteRow[]
  filtered: boolean
}) {
  const columns = [
    {
      key: 'number',
      header: 'Number',
      render: (r: QuoteRow) => (
        <span className="font-mono text-xs font-medium">{r.number}</span>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      render: (r: QuoteRow) => r.client_name,
    },
    {
      key: 'pm',
      header: 'PM',
      render: (r: QuoteRow) => (
        <span className="text-muted-foreground">{r.pm_name ?? '—'}</span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (r: QuoteRow) => (
        <span className="font-medium">{r.title}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: QuoteRow) => <StatusBadge status={r.status} />,
    },
    {
      key: 'total',
      header: 'Total (ex GST)',
      className: 'text-right',
      render: (r: QuoteRow) => (
        <span className="block text-right tabular-nums">{aud(r.total_sell)}</span>
      ),
    },
    {
      key: 'margin',
      header: 'Margin',
      className: 'text-right',
      render: (r: QuoteRow) => (
        <span className="block text-right tabular-nums">
          {r.total_sell > 0 ? pct(r.margin_pct) : '—'}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      className: 'text-right',
      render: (r: QuoteRow) => (
        <span className="block text-right tabular-nums text-muted-foreground">
          {r.age_days}d
        </span>
      ),
    },
    {
      key: 'sent',
      header: 'Sent',
      render: (r: QuoteRow) => (
        <span className="text-muted-foreground">
          {r.sent_at ? fmtDate(r.sent_at) : '—'}
        </span>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      onRowHref={(r) => `/quotes/${r.id}`}
      empty={
        filtered ? (
          <EmptyState
            title="No quotes with this status"
            description="Try another filter."
          />
        ) : (
          <EmptyState
            icon={<FileTextIcon className="size-8" />}
            title="No quotes yet"
            description="Create your first quote to get started."
          />
        )
      }
    />
  )
}
