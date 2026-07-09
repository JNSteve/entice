'use client'

import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, fmtDate } from '@/lib/format'
import { BriefcaseIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export interface JobRow {
  id: string
  number: string
  title: string
  client_name: string
  site_name: string | null
  status: string
  supervisor_name: string | null
  pm_name: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  quoted_value: number | null
}

export function JobsTable({
  rows,
  filtered,
}: {
  rows: JobRow[]
  filtered: boolean
}) {
  const columns = [
    {
      key: 'number',
      header: 'Number',
      render: (r: JobRow) => (
        <span className="font-mono text-xs font-medium">{r.number}</span>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      render: (r: JobRow) => (
        <span className="font-medium">{r.title}</span>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      render: (r: JobRow) => (
        <span className="text-muted-foreground">{r.client_name}</span>
      ),
    },
    {
      key: 'site',
      header: 'Site',
      render: (r: JobRow) => (
        <span className="text-muted-foreground">{r.site_name ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: JobRow) => <StatusBadge status={r.status} />,
    },
    {
      key: 'supervisor',
      header: 'Supervisor',
      render: (r: JobRow) => (
        <span className="text-muted-foreground">{r.supervisor_name ?? '—'}</span>
      ),
    },
    {
      key: 'pm',
      header: 'PM',
      render: (r: JobRow) => (
        <span className="text-muted-foreground">{r.pm_name ?? '—'}</span>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (r: JobRow) => {
        if (!r.scheduled_start) {
          return (
            <Badge variant="outline" className="text-muted-foreground text-xs font-normal">
              Unscheduled
            </Badge>
          )
        }
        const end = r.scheduled_end ? ` – ${fmtDate(r.scheduled_end)}` : ''
        return (
          <span className="text-sm text-muted-foreground tabular-nums">
            {fmtDate(r.scheduled_start)}{end}
          </span>
        )
      },
    },
    {
      key: 'value',
      header: 'Quoted value',
      className: 'text-right',
      render: (r: JobRow) => (
        <span className="block text-right tabular-nums">
          {r.quoted_value != null ? aud(r.quoted_value) : '—'}
        </span>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      onRowHref={(r) => `/jobs/${r.id}`}
      empty={
        filtered ? (
          <EmptyState
            title="No jobs with this status"
            description="Try another filter."
          />
        ) : (
          <EmptyState
            icon={<BriefcaseIcon className="size-8" />}
            title="No jobs yet"
            description="Create your first job to get started."
          />
        )
      }
    />
  )
}
