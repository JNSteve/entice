'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { round2 } from '@/lib/money'
import { PlusIcon, ReceiptIcon } from 'lucide-react'
import { createClaim } from './actions'

export interface ClaimRow {
  id: string
  number: number
  status: string
  reference_date: string
  /** This claim, ex GST. Live-computed for drafts, snapshot otherwise. */
  subtotal: number | null
  claimed_to_date: number | null
  total_inc_gst: number | null
  certified_amount: number | null
  submitted_at: string | null
  paid_at: string | null
}

// ─── New claim button ─────────────────────────────────────────────────────────

export function NewClaimButton({
  projectId,
  disabledReason,
}: {
  projectId: string
  disabledReason: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleCreate() {
    startTransition(async () => {
      const result = await createClaim(projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Claim created')
      router.push(`/projects/${projectId}/claims/${result.id}`)
    })
  }

  return (
    <span title={disabledReason ?? undefined}>
      <Button
        size="sm"
        onClick={handleCreate}
        disabled={pending || disabledReason !== null}
      >
        <PlusIcon className="size-4" />
        {pending ? 'Creating…' : 'New claim'}
      </Button>
    </span>
  )
}

// ─── Claims table ─────────────────────────────────────────────────────────────

export function ClaimsTable({
  projectId,
  claims,
}: {
  projectId: string
  claims: ClaimRow[]
}) {
  if (claims.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptIcon className="size-8" />}
        title="No claims yet"
        description="Create a claim to snapshot the budget and approved variations into a payment claim."
      />
    )
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim #</TableHead>
            <TableHead>Reference date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">This claim (ex GST)</TableHead>
            <TableHead className="text-right">Claimed to date</TableHead>
            <TableHead className="text-right">Certified</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.map((c) => {
            const certifiedSet =
              (c.status === 'certified' || c.status === 'paid') &&
              c.certified_amount != null
            const variance =
              certifiedSet && c.total_inc_gst != null
                ? round2((c.certified_amount as number) - c.total_inc_gst)
                : 0
            return (
              <TableRow
                key={c.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  window.location.href = `/projects/${projectId}/claims/${c.id}`
                }}
              >
                <TableCell className="font-mono font-medium">
                  <Link
                    href={`/projects/${projectId}/claims/${c.id}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    PC-{c.number}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">{fmtDate(c.reference_date)}</TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.subtotal != null ? aud(c.subtotal) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {c.claimed_to_date != null ? aud(c.claimed_to_date) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {certifiedSet ? (
                    <span className="inline-flex items-center justify-end gap-2">
                      {variance !== 0 && (
                        <Badge
                          variant="outline"
                          className={
                            variance < 0
                              ? 'border-red-200 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                              : 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          }
                          title={
                            variance < 0
                              ? 'Certified below the claimed amount'
                              : 'Certified above the claimed amount'
                          }
                        >
                          {variance < 0 ? '−' : '+'}
                          {aud(Math.abs(variance))}
                        </Badge>
                      )}
                      <span className="tabular-nums">{aud(c.certified_amount as number)}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {c.submitted_at ? fmtDate(c.submitted_at) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {c.paid_at ? fmtDate(c.paid_at) : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
