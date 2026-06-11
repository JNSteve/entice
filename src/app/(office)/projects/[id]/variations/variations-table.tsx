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
import { GitBranchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VariationDetailDialog } from './variation-dialog'
import type { AttachmentItem } from '@/components/AttachmentList'

export interface VariationRow {
  id: string
  number: number
  title: string
  description: string | null
  status: string
  cost_estimate: number | null
  sell_amount: number | null
  client_ref: string | null
  time_bar_date: string | null
  submitted_at: string | null
  decided_at: string | null
  notes: string | null
}

interface VariationsTableProps {
  projectId: string
  variations: VariationRow[]
  attachmentsByVariation: Record<string, AttachmentItem[]>
}

const OPEN_STATUSES = new Set(['notified', 'priced', 'submitted'])

function timBarClass(dateStr: string | null, status: string): string {
  if (!dateStr || !OPEN_STATUSES.has(status)) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const bar = new Date(dateStr)
  bar.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((bar.getTime() - today.getTime()) / 86_400_000)

  if (diffDays < 0 || diffDays <= 3) return 'text-red-600 dark:text-red-400 font-semibold'
  if (diffDays <= 7) return 'text-amber-600 dark:text-amber-500 font-medium'
  return ''
}

export function VariationsTable({
  projectId,
  variations,
  attachmentsByVariation,
}: VariationsTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = variations.find((v) => v.id === selectedId) ?? null

  if (variations.length === 0) {
    return (
      <EmptyState
        icon={<GitBranchIcon className="size-8" />}
        title="No variations yet"
        description="Create a variation to track changes to the contract scope or price."
      />
    )
  }

  // Summary counts
  const byStatus = variations.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1
    return acc
  }, {})

  const approvedSell = variations
    .filter((v) => v.status === 'approved')
    .reduce((s, v) => s + (v.sell_amount ?? 0), 0)

  const statusOrder = ['notified', 'priced', 'submitted', 'approved', 'rejected']
  const summaryParts = statusOrder
    .filter((s) => byStatus[s])
    .map((s) => `${byStatus[s]} ${s}`)

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground">
            {summaryParts.join(' · ')}
          </span>
          <span className="font-medium">
            Approved variations:{' '}
            <span className="tabular-nums">{aud(approvedSell)}</span>
            {' '}— added to contract sum
          </span>
        </div>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>VO#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Cost est.</TableHead>
              <TableHead className="text-right">Sell</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead>Client ref</TableHead>
              <TableHead>Time bar</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Decided</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variations.map((v) => {
              const margin =
                v.sell_amount != null && v.cost_estimate != null
                  ? v.sell_amount - v.cost_estimate
                  : null
              const tbClass = timBarClass(v.time_bar_date, v.status)

              return (
                <TableRow
                  key={v.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedId(v.id)}
                >
                  <TableCell className="font-mono font-medium whitespace-nowrap">
                    V-{v.number}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{v.title}</TableCell>
                  <TableCell>
                    <StatusBadge status={v.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {v.cost_estimate != null ? aud(v.cost_estimate) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {v.sell_amount != null ? aud(v.sell_amount) : '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      margin != null && margin < 0 ? 'text-red-600' : ''
                    )}
                  >
                    {margin != null ? aud(margin) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {v.client_ref ?? '—'}
                  </TableCell>
                  <TableCell className={cn('tabular-nums', tbClass)}>
                    {v.time_bar_date ? fmtDate(v.time_bar_date) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {v.submitted_at ? fmtDate(v.submitted_at) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {v.decided_at ? fmtDate(v.decided_at) : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {selected && (
        <VariationDetailDialog
          key={selected.id}
          projectId={projectId}
          variation={selected}
          attachments={attachmentsByVariation[selected.id] ?? []}
          open
          onOpenChange={(open) => { if (!open) setSelectedId(null) }}
        />
      )}
    </div>
  )
}
