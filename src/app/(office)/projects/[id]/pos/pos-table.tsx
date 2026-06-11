'use client'

import Link from 'next/link'
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
import { lineTotal, round2 } from '@/lib/money'
import { FileTextIcon } from 'lucide-react'

export interface PoRow {
  id: string
  number: string
  vendor_name: string
  status: string
  issue_date: string | null
  lines: Array<{ qty: number; unit_cost: number }>
}

interface PosTableProps {
  projectId: string
  pos: PoRow[]
}

export function PosTable({ projectId, pos }: PosTableProps) {
  if (pos.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon className="size-8" />}
        title="No purchase orders yet"
        description="Create a PO to order goods or services from a vendor."
      />
    )
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Number</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total ex GST</TableHead>
            <TableHead>Issue date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pos.map((po) => {
            const total = round2(
              po.lines.reduce((s, l) => s + lineTotal(Number(l.qty), Number(l.unit_cost)), 0)
            )
            return (
              <TableRow
                key={po.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  window.location.href = `/projects/${projectId}/pos/${po.id}`
                }}
              >
                <TableCell className="font-mono font-medium">
                  <Link
                    href={`/projects/${projectId}/pos/${po.id}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {po.number}
                  </Link>
                </TableCell>
                <TableCell>{po.vendor_name}</TableCell>
                <TableCell>
                  <StatusBadge status={po.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{aud(total)}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {po.issue_date ? fmtDate(po.issue_date) : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
