'use client'

import React, { useState } from 'react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ComplianceLight } from '@/components/ComplianceLight'
import { deriveComplianceStatus, type ComplianceDocSummary } from '@/lib/compliance'
import { TruckIcon } from 'lucide-react'

// Traffic-light derivation (30-day amber rule) lives in src/lib/compliance.ts,
// shared with the training/competency register. Re-exported for existing
// importers of this module.
export {
  deriveComplianceStatus,
  type ComplianceDocSummary,
  type ComplianceStatus,
} from '@/lib/compliance'

// ─── Row type ─────────────────────────────────────────────────────────────────

export interface VendorRow {
  id: string
  name: string
  trades: string[]
  contact_name: string | null
  phone: string | null
  payment_terms_days: number
  compliance_docs: ComplianceDocSummary[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VendorsTable({ rows }: { rows: VendorRow[] }) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.toLowerCase()
        return (
          r.name.toLowerCase().includes(q) ||
          r.trades.some((t) => t.toLowerCase().includes(q))
        )
      })
    : rows

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (r: VendorRow) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'trades',
      header: 'Trades',
      render: (r: VendorRow) => {
        if (r.trades.length === 0)
          return <span className="text-muted-foreground">—</span>
        const visible = r.trades.slice(0, 3)
        const extra = r.trades.length - 3
        return (
          <div className="flex flex-wrap gap-1">
            {visible.map((t) => (
              <Badge key={t} variant="secondary" className="font-normal">
                {t}
              </Badge>
            ))}
            {extra > 0 && (
              <Badge variant="secondary" className="font-normal">
                +{extra}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (r: VendorRow) => (
        <div className="flex flex-col">
          <span>{r.contact_name ?? '—'}</span>
          {r.phone && (
            <span className="text-xs text-muted-foreground">{r.phone}</span>
          )}
        </div>
      ),
    },
    {
      key: 'terms',
      header: 'Terms',
      render: (r: VendorRow) => `${r.payment_terms_days} days`,
    },
    {
      key: 'compliance',
      header: 'Compliance',
      render: (r: VendorRow) => {
        const status = deriveComplianceStatus(r.compliance_docs)
        return <ComplianceLight status={status} />
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Search suppliers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <DataTable
        columns={columns}
        rows={filtered}
        getRowKey={(r) => r.id}
        onRowHref={(r) => `/vendors/${r.id}`}
        empty={
          search.trim() ? (
            <EmptyState
              title="No suppliers match your search"
              description="Try a different name or trade."
            />
          ) : (
            <EmptyState
              icon={<TruckIcon className="size-8" />}
              title="No suppliers yet"
              description="Add your first supplier to get started."
            />
          )
        }
      />
    </div>
  )
}
