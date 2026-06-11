'use client'

import React, { useState } from 'react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { UsersIcon } from 'lucide-react'

interface ClientRow {
  id: string
  name: string
  type: string
  first_suburb: string | null
  payment_terms_days: number
  sites_count: number
  quotes_count: number
  jobs_count: number
  projects_count: number
}

const TYPE_LABELS: Record<string, string> = {
  builder: 'Builder',
  strata: 'Strata',
  council: 'Council',
  government: 'Government',
  facility_manager: 'Facility Mgr',
  insurer: 'Insurer',
  private: 'Private',
  other: 'Other',
}

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? rows.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.first_suburb ?? '').toLowerCase().includes(search.toLowerCase()) ||
        r.type.toLowerCase().includes(search.toLowerCase())
      )
    : rows

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (r: ClientRow) => (
        <span className="font-medium">{r.name}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (r: ClientRow) => (
        <Badge variant="secondary" className="capitalize font-normal">
          {TYPE_LABELS[r.type] ?? r.type}
        </Badge>
      ),
    },
    {
      key: 'suburb',
      header: 'Suburb',
      render: (r: ClientRow) => (
        <span className="text-muted-foreground">{r.first_suburb ?? '—'}</span>
      ),
    },
    {
      key: 'terms',
      header: 'Terms',
      render: (r: ClientRow) => `${r.payment_terms_days} days`,
    },
    {
      key: 'quotes',
      header: 'Quotes',
      className: 'text-right',
      render: (r: ClientRow) => (
        <span className="tabular-nums text-right block">{r.quotes_count}</span>
      ),
    },
    {
      key: 'jobs',
      header: 'Jobs',
      className: 'text-right',
      render: (r: ClientRow) => (
        <span className="tabular-nums text-right block">{r.jobs_count}</span>
      ),
    },
    {
      key: 'projects',
      header: 'Projects',
      className: 'text-right',
      render: (r: ClientRow) => (
        <span className="tabular-nums text-right block">{r.projects_count}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Search clients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <DataTable
        columns={columns}
        rows={filtered}
        getRowKey={(r) => r.id}
        onRowHref={(r) => `/clients/${r.id}`}
        empty={
          search.trim() ? (
            <EmptyState
              title="No clients match your search"
              description="Try a different name or suburb."
            />
          ) : (
            <EmptyState
              icon={<UsersIcon className="size-8" />}
              title="No clients yet"
              description="Add your first client to get started."
            />
          )
        }
      />
    </div>
  )
}
