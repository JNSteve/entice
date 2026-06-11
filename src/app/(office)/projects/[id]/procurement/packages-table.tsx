'use client'

import React, { useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { aud, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PackageIcon } from 'lucide-react'
import { PackageDialog } from './package-dialog'

export interface PackageRow {
  id: string
  name: string
  status: string
  budget_amount: number
  awarded_amount: number | null
  cost_code_id: string | null
  cost_code_code: string | null
  cost_code_name: string | null
  owner_id: string | null
  owner_name: string | null
  let_by_date: string | null
  notes: string | null
}

export interface CostCodeOption {
  id: string
  code: string
  name: string
}

export interface OwnerOption {
  id: string
  full_name: string
}

interface PackagesTableProps {
  projectId: string
  packages: PackageRow[]
  costCodes: CostCodeOption[]
  owners: OwnerOption[]
}

function letByClass(dateStr: string | null, status: string): string {
  if (!dateStr || status === 'awarded') return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const letBy = new Date(dateStr)
  letBy.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((letBy.getTime() - today.getTime()) / 86_400_000)

  if (diffDays < 0 || diffDays <= 7) return 'text-red-600 dark:text-red-400 font-semibold'
  if (diffDays <= 14) return 'text-amber-600 dark:text-amber-500 font-medium'
  return ''
}

export function PackagesTable({
  projectId,
  packages,
  costCodes,
  owners,
}: PackagesTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const selected = packages.find((p) => p.id === selectedId) ?? null

  // ── Summary calculations ────────────────────────────────────────────────────
  const countByStatus = packages.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    return acc
  }, {})

  const totalBudget = packages.reduce((s, p) => s + p.budget_amount, 0)

  const awardedPackages = packages.filter((p) => p.status === 'awarded' && p.awarded_amount != null)
  const totalAwarded = awardedPackages.reduce((s, p) => s + (p.awarded_amount ?? 0), 0)
  const savings = awardedPackages.reduce(
    (s, p) => s + (p.budget_amount - (p.awarded_amount ?? 0)),
    0
  )

  const statusOrder = ['planned', 'rfq_out', 'quotes_in', 'recommended', 'awarded']
  const summaryChips = statusOrder
    .filter((s) => countByStatus[s])
    .map((s) => ({ status: s, count: countByStatus[s] }))

  function openEdit(id: string) {
    setSelectedId(id)
    setDialogOpen(true)
  }

  function handleClose() {
    setDialogOpen(false)
    setSelectedId(null)
  }

  if (packages.length === 0) {
    return (
      <EmptyState
        icon={<PackageIcon className="size-8" />}
        title="No packages yet"
        description="Create a trade package to track procurement for a scope of works."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Status chips */}
          <div className="flex flex-wrap gap-2">
            {summaryChips.map(({ status, count }) => (
              <div
                key={status}
                className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5"
              >
                <StatusBadge status={status} />
                <span className="tabular-nums font-medium">{count}</span>
              </div>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              Budget:{' '}
              <span className="font-medium text-foreground tabular-nums">{aud(totalBudget)}</span>
            </span>
            {awardedPackages.length > 0 && (
              <>
                <span>
                  Awarded:{' '}
                  <span className="font-medium text-foreground tabular-nums">{aud(totalAwarded)}</span>
                </span>
                <span>
                  Savings:{' '}
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      savings >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {aud(savings)}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Package</TableHead>
              <TableHead>Cost code</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Let-by date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Awarded</TableHead>
              <TableHead className="text-right">vs Budget</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map((pkg) => {
              const lbClass = letByClass(pkg.let_by_date, pkg.status)
              const delta =
                pkg.status === 'awarded' && pkg.awarded_amount != null
                  ? pkg.awarded_amount - pkg.budget_amount
                  : null

              return (
                <TableRow
                  key={pkg.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    window.location.href = `/projects/${projectId}/procurement/${pkg.id}`
                  }}
                >
                  <TableCell
                    className="font-medium max-w-[200px] truncate"
                    onClick={(e) => {
                      e.stopPropagation()
                      openEdit(pkg.id)
                    }}
                  >
                    <span className="hover:underline cursor-pointer">{pkg.name}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {pkg.cost_code_code
                      ? `${pkg.cost_code_code} — ${pkg.cost_code_name}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(pkg.budget_amount)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {pkg.owner_name ?? '—'}
                  </TableCell>
                  <TableCell className={cn('tabular-nums', lbClass)}>
                    {pkg.let_by_date ? fmtDate(pkg.let_by_date) : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={pkg.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {pkg.awarded_amount != null ? aud(pkg.awarded_amount) : '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      delta != null && delta > 0
                        ? 'text-red-600 dark:text-red-400'
                        : delta != null && delta < 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {delta != null ? aud(delta) : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      {dialogOpen && selected && (
        <PackageDialog
          key={selected.id}
          projectId={projectId}
          pkg={selected}
          costCodes={costCodes}
          owners={owners}
          open
          onOpenChange={(v) => { if (!v) handleClose() }}
        />
      )}
    </div>
  )
}
