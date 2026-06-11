'use client'

import React, { useState } from 'react'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { TruckIcon } from 'lucide-react'

// ─── Traffic light derivation ─────────────────────────────────────────────────
//
// green  = has ≥1 doc AND all expiry_date > 30 days away
// amber  = any doc expiring within 30 days (but none expired)
// red    = any expired OR zero docs

export type ComplianceStatus = 'green' | 'amber' | 'red'

export interface ComplianceDocSummary {
  expiry_date: string // ISO date string
}

export function deriveComplianceStatus(
  docs: ComplianceDocSummary[]
): ComplianceStatus {
  if (docs.length === 0) return 'red'

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const in30 = new Date(today)
  in30.setDate(in30.getDate() + 30)

  let hasAmber = false

  for (const doc of docs) {
    const expiry = new Date(doc.expiry_date)
    if (expiry < today) return 'red'
    if (expiry <= in30) hasAmber = true
  }

  return hasAmber ? 'amber' : 'green'
}

function complianceTitle(status: ComplianceStatus): string {
  switch (status) {
    case 'green':
      return 'All compliance documents current'
    case 'amber':
      return 'One or more documents expire within 30 days'
    case 'red':
      return 'Expired or missing compliance documents'
  }
}

function ComplianceLight({ status }: { status: ComplianceStatus }) {
  const colours = {
    green: 'bg-green-500',
    amber: 'bg-amber-400',
    red: 'bg-red-500',
  }
  return (
    <span
      className={`inline-block size-3 rounded-full ${colours[status]}`}
      title={complianceTitle(status)}
      aria-label={complianceTitle(status)}
    />
  )
}

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
        placeholder="Search vendors…"
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
              title="No vendors match your search"
              description="Try a different name or trade."
            />
          ) : (
            <EmptyState
              icon={<TruckIcon className="size-8" />}
              title="No vendors yet"
              description="Add your first vendor to get started."
            />
          )
        }
      />
    </div>
  )
}
