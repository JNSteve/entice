'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { ChevronDownIcon, ChevronRightIcon, FileDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { aud, pct } from '@/lib/format'
import { round2 } from '@/lib/money'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

export type CostCodeBreakdown = {
  key: string
  label: string
  budget: number
  committed: number
  actual: number
}

export type ProfitabilityRow = {
  id: string
  number: string
  name: string
  status: string
  /** Contract sum + approved variations (sell). */
  adjusted: number
  /** Max total_claimed_to_date across non-draft claims. */
  claimed: number
  budget: number
  committed: number
  actual: number
  /** Per cost code Σ max(committed, actual). */
  forecastCost: number
  /** adjusted − forecastCost. */
  forecastMargin: number
  /** forecastMargin / adjusted, 0 when adjusted is 0. */
  marginPct: number
  codes: CostCodeBreakdown[]
}

function MarginCell({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'tabular-nums font-medium',
        value < 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-green-700 dark:text-green-400'
      )}
    >
      {aud(value)}
    </span>
  )
}

export function ProfitabilityReport({ rows }: { rows: ProfitabilityRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totals = {
    adjusted: round2(rows.reduce((s, r) => s + r.adjusted, 0)),
    claimed: round2(rows.reduce((s, r) => s + r.claimed, 0)),
    budget: round2(rows.reduce((s, r) => s + r.budget, 0)),
    committed: round2(rows.reduce((s, r) => s + r.committed, 0)),
    actual: round2(rows.reduce((s, r) => s + r.actual, 0)),
    forecastCost: round2(rows.reduce((s, r) => s + r.forecastCost, 0)),
    forecastMargin: round2(rows.reduce((s, r) => s + r.forecastMargin, 0)),
  }
  const totalMarginPct =
    totals.adjusted > 0
      ? round2((totals.forecastMargin / totals.adjusted) * 100)
      : 0

  function handleExport() {
    downloadCsv(
      `profitability-${format(new Date(), 'yyyyMMdd')}.csv`,
      rows.map((r) => ({
        Project: r.number,
        Name: r.name,
        Status: r.status,
        'Adjusted contract': r.adjusted,
        'Claimed to date': r.claimed,
        Budget: r.budget,
        Committed: r.committed,
        Actual: r.actual,
        'Forecast cost': r.forecastCost,
        'Forecast margin': r.forecastMargin,
        'Margin %': r.marginPct,
      }))
    )
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No active projects to report on.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <FileDownIcon className="size-4" />
          Export CSV
        </Button>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Adjusted contract</TableHead>
              <TableHead className="text-right">Claimed to date</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Committed</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Forecast cost</TableHead>
              <TableHead className="text-right">Forecast margin</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isOpen = expanded.has(r.id)
              return (
                <React.Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => toggle(r.id)}
                        disabled={r.codes.length === 0}
                        aria-label={isOpen ? 'Collapse cost codes' : 'Expand cost codes'}
                      >
                        {isOpen ? (
                          <ChevronDownIcon className="size-4" />
                        ) : (
                          <ChevronRightIcon className="size-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        <span className="font-mono text-xs">{r.number}</span>{' '}
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.adjusted)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.claimed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.budget)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.committed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.actual)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.forecastCost)}
                    </TableCell>
                    <TableCell className="text-right">
                      <MarginCell value={r.forecastMargin} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        r.forecastMargin < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {pct(r.marginPct)}
                    </TableCell>
                  </TableRow>

                  {isOpen &&
                    r.codes.map((c) => (
                      <TableRow key={`${r.id}-${c.key}`} className="bg-muted/40">
                        <TableCell />
                        <TableCell
                          colSpan={4}
                          className="pl-8 text-xs text-muted-foreground"
                        >
                          {c.label}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {aud(c.budget)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {aud(c.committed)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {aud(c.actual)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {aud(Math.max(c.committed, c.actual))}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    ))}
                </React.Fragment>
              )
            })}

            {/* Totals */}
            <TableRow className="bg-muted font-medium">
              <TableCell />
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="text-right tabular-nums">
                {aud(totals.adjusted)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {aud(totals.claimed)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {aud(totals.budget)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {aud(totals.committed)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {aud(totals.actual)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {aud(totals.forecastCost)}
              </TableCell>
              <TableCell className="text-right">
                <MarginCell value={totals.forecastMargin} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {pct(totalMarginPct)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
