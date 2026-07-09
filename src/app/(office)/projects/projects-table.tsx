'use client'

import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, pct } from '@/lib/format'
import { FolderKanbanIcon } from 'lucide-react'

export interface ProjectRow {
  id: string
  number: string
  name: string
  client_name: string
  status: string
  pm_name: string | null
  /** contract_sum + Σ approved variation sell. Null when money is hidden. */
  adjusted_sum: number | null
  /** Latest non-draft claim's total claimed to date. Null when money is hidden. */
  claimed_to_date: number | null
}

export function ProjectsTable({
  rows,
  showMoney,
  canCreate,
}: {
  rows: ProjectRow[]
  showMoney: boolean
  canCreate: boolean
}) {
  const columns = [
    {
      key: 'number',
      header: 'Number',
      render: (r: ProjectRow) => (
        <span className="font-mono text-xs font-medium">{r.number}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: (r: ProjectRow) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'client',
      header: 'Client',
      render: (r: ProjectRow) => (
        <span className="text-muted-foreground">{r.client_name}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: ProjectRow) => <StatusBadge status={r.status} />,
    },
    {
      key: 'pm',
      header: 'PM',
      render: (r: ProjectRow) => (
        <span className="text-muted-foreground">{r.pm_name ?? '—'}</span>
      ),
    },
    ...(showMoney
      ? [
          {
            key: 'adjusted_sum',
            header: 'Adjusted contract sum',
            className: 'text-right',
            render: (r: ProjectRow) => (
              <span className="block text-right tabular-nums">
                {r.adjusted_sum != null ? aud(r.adjusted_sum) : '—'}
              </span>
            ),
          },
          {
            key: 'claimed',
            header: 'Claimed to date',
            className: 'text-right',
            render: (r: ProjectRow) => (
              <span className="block text-right tabular-nums">
                {r.claimed_to_date != null ? aud(r.claimed_to_date) : '—'}
              </span>
            ),
          },
          {
            key: 'pct_claimed',
            header: '% claimed',
            className: 'text-right',
            render: (r: ProjectRow) => {
              if (
                r.adjusted_sum == null ||
                r.adjusted_sum <= 0 ||
                r.claimed_to_date == null
              ) {
                return (
                  <span className="block text-right text-muted-foreground">—</span>
                )
              }
              return (
                <span className="block text-right tabular-nums">
                  {pct(
                    Math.round((r.claimed_to_date / r.adjusted_sum) * 1000) / 10
                  )}
                </span>
              )
            },
          },
        ]
      : []),
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      onRowHref={(r) => `/projects/${r.id}`}
      empty={
        <EmptyState
          icon={<FolderKanbanIcon className="size-8" />}
          title="No projects yet"
          description={
            canCreate
              ? 'Create your first project to get started.'
              : 'Projects you are assigned to will appear here.'
          }
        />
      }
    />
  )
}
