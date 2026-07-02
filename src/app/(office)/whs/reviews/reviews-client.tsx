'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtDate } from '@/lib/format'
import type { MgmtReviewStatus } from '@/lib/zod'
import { createReview } from './actions'

export interface ReviewRow {
  id: string
  number: string
  review_date: string
  period_covered: string | null
  chair_name: string | null
  status: MgmtReviewStatus
  closed_at: string | null
  open_action_count: number
}

export interface ProfileOption {
  id: string
  full_name: string
}

// ─── Start review dialog ──────────────────────────────────────────────────────

function StartReviewDialog({
  open,
  onOpenChange,
  profiles,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: ProfileOption[]
  today: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [reviewDate, setReviewDate] = useState(today)
  const [periodCovered, setPeriodCovered] = useState('')
  const [chairedBy, setChairedBy] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createReview({
        review_date: reviewDate,
        period_covered: periodCovered || null,
        chaired_by: chairedBy || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Review started — all 13 mandated inputs seeded with live register data')
      onOpenChange(false)
      router.push(`/whs/reviews/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start management review</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Review date</Label>
              <Input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Chaired by</Label>
              <Select
                value={chairedBy}
                onValueChange={(v) => setChairedBy(!v || v === '__none' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Period covered</Label>
            <Input
              value={periodCovered}
              onChange={(e) => setPeriodCovered(e.target.value)}
              placeholder="e.g. Jul 2025 – Jun 2026"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Starting a review seeds the 13 ISO-mandated inputs (9.3.2) and
            pulls a fresh data snapshot from the live registers for each —
            NCRs, incidents, audits, objectives, risks, training and more.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Pulling register data…' : 'Start review'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function ReviewsClient({
  items,
  profiles,
  canManage,
  today,
}: {
  items: ReviewRow[]
  profiles: ProfileOption[]
  canManage: boolean
  today: string
}) {
  const [startOpen, setStartOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? 'No management reviews yet.'
            : `${items.length} review${items.length === 1 ? '' : 's'} on record.`}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setStartOpen(true)}>
            <PlusIcon className="size-4" />
            Start review
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Review date</TableHead>
                <TableHead>Period covered</TableHead>
                <TableHead>Chair</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Open actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-medium">
                    <Link href={`/whs/reviews/${r.id}`} className="hover:underline">
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{fmtDate(r.review_date)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.period_covered ?? '—'}
                  </TableCell>
                  <TableCell>{r.chair_name ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.open_action_count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <StartReviewDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        profiles={profiles}
        today={today}
      />
    </div>
  )
}
