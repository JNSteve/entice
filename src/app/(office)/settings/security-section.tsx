'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import { PlusIcon, ShieldCheckIcon } from 'lucide-react'
import { createAccessReview } from './actions'

export interface AccessReviewRow {
  id: string
  number: string
  reviewed_on: string
  reviewer_name: string | null
  findings: string
  actions: string | null
  next_review_due: string
}

export interface ReviewerOption {
  id: string
  full_name: string
}

/**
 * Security tab (admin-only page): the periodic access review register
 * (ACR-xxxx) — who has an account, are the roles right, have credentials
 * been rotated. An overdue next_review_due raises a dashboard row.
 */
export function SecuritySection({
  reviews,
  reviewers,
}: {
  reviews: AccessReviewRow[]
  reviewers: ReviewerOption[]
}) {
  const todayStr = todayAUClient()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access reviews</CardTitle>
        <CardDescription>
          Record the periodic review of who can sign in and what they can do.
          Checklist: are the user accounts current (leavers deactivated)? Are
          the roles still right for each person? Have demo/default passwords
          been rotated? Is Supabase leaked-password protection switched on
          (dashboard → Auth → Passwords)?
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <AccessReviewDialog reviewers={reviewers} />
        </div>
        <DataTable
          columns={[
            {
              key: 'number',
              header: 'Number',
              render: (r: AccessReviewRow) => (
                <span className="font-medium">{r.number}</span>
              ),
            },
            {
              key: 'reviewed_on',
              header: 'Reviewed',
              render: (r: AccessReviewRow) => (
                <span className="tabular-nums">{fmtDate(r.reviewed_on)}</span>
              ),
            },
            {
              key: 'reviewer',
              header: 'Reviewer',
              render: (r: AccessReviewRow) => (
                <span className="text-muted-foreground">
                  {r.reviewer_name ?? '—'}
                </span>
              ),
            },
            {
              key: 'findings',
              header: 'Findings',
              render: (r: AccessReviewRow) => (
                <span className="block max-w-md truncate" title={r.findings}>
                  {r.findings}
                </span>
              ),
            },
            {
              key: 'actions_taken',
              header: 'Actions',
              render: (r: AccessReviewRow) => (
                <span
                  className="block max-w-xs truncate text-muted-foreground"
                  title={r.actions ?? undefined}
                >
                  {r.actions ?? '—'}
                </span>
              ),
            },
            {
              key: 'next_review_due',
              header: 'Next review',
              render: (r: AccessReviewRow) => (
                <span
                  className={
                    r.next_review_due < todayStr
                      ? 'font-medium text-red-600 tabular-nums dark:text-red-400'
                      : 'tabular-nums'
                  }
                >
                  {fmtDate(r.next_review_due)}
                </span>
              ),
            },
          ]}
          rows={reviews}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<ShieldCheckIcon className="size-8" />}
              title="No access reviews yet"
              description="Record the first review (ACR-0001) once you have checked accounts, roles and passwords."
            />
          }
        />
      </CardContent>
    </Card>
  )
}

function AccessReviewDialog({ reviewers }: { reviewers: ReviewerOption[] }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [reviewedOn, setReviewedOn] = useState(todayAUClient())
  const [reviewerId, setReviewerId] = useState<string>(reviewers[0]?.id ?? '')
  const [findings, setFindings] = useState('')
  const [actions, setActions] = useState('')
  const [nextDue, setNextDue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createAccessReview({
        reviewed_on: reviewedOn,
        reviewer_id: reviewerId,
        findings,
        actions,
        next_review_due: nextDue,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Access review recorded')
      setOpen(false)
      setFindings('')
      setActions('')
      setNextDue('')
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        Record access review
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record access review</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Work through: accounts current? roles right? passwords rotated?
              leaked-password protection on? Note what you found and what you
              changed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ar-date">Reviewed on</Label>
                <Input
                  id="ar-date"
                  type="date"
                  value={reviewedOn}
                  onChange={(e) => setReviewedOn(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ar-reviewer">Reviewer</Label>
                <Select value={reviewerId} onValueChange={(v) => setReviewerId(v as string)}>
                  <SelectTrigger id="ar-reviewer" className="w-full">
                    <SelectValue placeholder="Select reviewer" />
                  </SelectTrigger>
                  <SelectContent>
                    {reviewers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-findings">Findings</Label>
              <Textarea
                id="ar-findings"
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                placeholder="Accounts and roles verified; two stale accounts deactivated…"
                rows={3}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-actions">Actions taken (optional)</Label>
              <Textarea
                id="ar-actions"
                value={actions}
                onChange={(e) => setActions(e.target.value)}
                placeholder="Rotated office password; enabled leaked-password protection…"
                rows={2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-next">Next review due</Label>
              <Input
                id="ar-next"
                type="date"
                value={nextDue}
                onChange={(e) => setNextDue(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !reviewerId}>
                {pending ? 'Saving…' : 'Record review'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
