'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  UndoIcon,
  RefreshCwIcon,
  FileTextIcon,
  LockIcon,
  UnlockIcon,
} from 'lucide-react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { AuditHistory } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  MGMT_REVIEW_INPUT_DEFS,
  MGMT_REVIEW_STANDARD_LABELS,
  type MgmtReviewInputKey,
} from '@/lib/mgmt-review'
import type { InputSnapshot } from '@/lib/mgmt-review-data'
import {
  RAG_STATUSES,
  RAG_LABELS,
  type MgmtReviewStatus,
  type RagStatus,
} from '@/lib/zod'
import type { ProfileOption } from '../reviews-client'
import {
  addAttendee,
  closeReview,
  createReviewAction,
  deleteReview,
  deleteReviewAction,
  refreshReviewInputData,
  removeAttendee,
  reopenReview,
  setReviewActionDone,
  updateReview,
  updateReviewAction,
  updateReviewInput,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewDetailData {
  id: string
  number: string
  review_date: string
  period_covered: string | null
  status: MgmtReviewStatus
  general_minutes: string | null
  chaired_by: string | null
  chair_name: string | null
  created_by_name: string | null
  closed_at: string | null
  created_at: string
}

export interface InputRow {
  id: string
  input_key: MgmtReviewInputKey
  rag: RagStatus | null
  minute: string | null
  data: InputSnapshot | null
  reviewed: boolean
  reviewed_by_name: string | null
  reviewed_at: string | null
}

export interface AttendeeRow {
  id: string
  profile_id: string | null
  name: string
  role_title: string | null
  external: boolean
}

export interface ActionRow {
  id: string
  description: string
  assigned_to: string | null
  assigned_to_name: string | null
  due_date: string | null
  status: 'open' | 'done'
  completed_at: string | null
}

type Role = 'admin' | 'office' | 'supervisor'

// ─── RAG picker ───────────────────────────────────────────────────────────────

const RAG_DOT: Record<RagStatus, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
}

const RAG_ACTIVE: Record<RagStatus, string> = {
  green:
    'border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  amber:
    'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  red: 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
}

function RagPicker({
  value,
  onChange,
  disabled,
}: {
  value: RagStatus | null
  onChange: (rag: RagStatus | null) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      {RAG_STATUSES.map((rag) => (
        <button
          key={rag}
          type="button"
          title={RAG_LABELS[rag]}
          disabled={disabled}
          onClick={() => onChange(value === rag ? null : rag)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors',
            value === rag
              ? RAG_ACTIVE[rag]
              : 'border-transparent text-muted-foreground hover:border-muted-foreground/40',
            disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          <span className={cn('size-2 rounded-full', RAG_DOT[rag])} />
          {rag}
        </button>
      ))}
    </div>
  )
}

// ─── Snapshot renderer ────────────────────────────────────────────────────────

function SnapshotView({ snapshot }: { snapshot: InputSnapshot }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {snapshot.figures.map((f) => (
          <div key={f.label} className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {f.label}
            </span>
            <span className="text-sm font-semibold tabular-nums">{f.value}</span>
          </div>
        ))}
      </div>
      {snapshot.rows && snapshot.rows.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t pt-2">
          {snapshot.rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
              <span
                className={cn(
                  'shrink-0 font-medium tabular-nums',
                  r.flag === 'red' && 'text-red-600 dark:text-red-400',
                  r.flag === 'amber' && 'text-amber-600 dark:text-amber-400',
                  r.flag === 'green' && 'text-green-600 dark:text-green-400'
                )}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Data window {fmtDate(snapshot.window.start)} – {fmtDate(snapshot.window.end)}{' '}
        ({snapshot.window.basis === 'last_closed_review'
          ? 'since the last closed review'
          : 'trailing 12 months'})
        {' · '}snapshot taken {fmtDate(snapshot.computed_at)}
      </p>
    </div>
  )
}

// ─── Input checklist item ─────────────────────────────────────────────────────

function InputItem({
  input,
  reviewId,
  locked,
  canManage,
}: {
  input: InputRow
  reviewId: string
  locked: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  const [minute, setMinute] = useState(input.minute ?? '')
  const def = MGMT_REVIEW_INPUT_DEFS[input.input_key]
  const editable = canManage && !locked
  const dirty = minute !== (input.minute ?? '')

  function save(patch: { rag?: RagStatus | null; reviewed?: boolean }) {
    startTransition(async () => {
      const result = await updateReviewInput(input.id, reviewId, {
        minute: minute || null,
        ...patch,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (patch.reviewed === true) toast.success(`${def.label} marked reviewed`)
      else if (patch.reviewed === false) toast.success('Marked un-reviewed')
      else toast.success('Saved')
      router.refresh()
    })
  }

  function handleRefreshData() {
    startRefresh(async () => {
      const result = await refreshReviewInputData(input.id, reviewId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Data snapshot refreshed')
      router.refresh()
    })
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4',
        input.reviewed && 'border-green-200 dark:border-green-900'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{def.label}</h3>
            {def.standards.map((s) => (
              <span
                key={s}
                className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {MGMT_REVIEW_STANDARD_LABELS[s]}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{def.helper}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RagPicker
            value={input.rag}
            onChange={(rag) => save({ rag })}
            disabled={!editable || pending}
          />
        </div>
      </div>

      {input.data && <SnapshotView snapshot={input.data} />}
      {def.auto && editable && (
        <div className="-mt-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={handleRefreshData}
            disabled={refreshing}
          >
            <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </Button>
        </div>
      )}

      {editable ? (
        <Textarea
          value={minute}
          onChange={(e) => setMinute(e.target.value)}
          placeholder="Minute — what was discussed, conclusions reached…"
          rows={2}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm">
          {input.minute ?? <span className="text-muted-foreground">No minute recorded.</span>}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {input.reviewed
            ? `Reviewed${input.reviewed_by_name ? ` by ${input.reviewed_by_name}` : ''}${
                input.reviewed_at ? ` on ${fmtDate(input.reviewed_at)}` : ''
              }`
            : 'Not yet reviewed'}
        </span>
        {editable && (
          <div className="flex items-center gap-2">
            {dirty && (
              <Button size="sm" variant="outline" onClick={() => save({})} disabled={pending}>
                Save minute
              </Button>
            )}
            {input.reviewed ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => save({ reviewed: false })}
                disabled={pending}
              >
                <UndoIcon className="size-4" />
                Un-review
              </Button>
            ) : (
              <Button size="sm" onClick={() => save({ reviewed: true })} disabled={pending}>
                <CheckIcon className="size-4" />
                Mark reviewed
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Edit review dialog ───────────────────────────────────────────────────────

function EditReviewDialog({
  open,
  onOpenChange,
  review,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  review: ReviewDetailData
  profiles: ProfileOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [reviewDate, setReviewDate] = useState(review.review_date)
  const [periodCovered, setPeriodCovered] = useState(review.period_covered ?? '')
  const [chairedBy, setChairedBy] = useState(review.chaired_by ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateReview(review.id, {
        review_date: reviewDate,
        period_covered: periodCovered || null,
        chaired_by: chairedBy || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Review updated')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {review.number}</DialogTitle>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Attendee dialog ──────────────────────────────────────────────────────────

function AttendeeDialog({
  open,
  onOpenChange,
  reviewId,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reviewId: string
  profiles: ProfileOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [profileId, setProfileId] = useState('')
  const [name, setName] = useState('')
  const [roleTitle, setRoleTitle] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await addAttendee({
        review_id: reviewId,
        profile_id: profileId || null,
        name: name || null,
        role_title: roleTitle || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Attendee added')
      setProfileId('')
      setName('')
      setRoleTitle('')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add attendee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Team member</Label>
            <Select
              value={profileId}
              onValueChange={(v) => setProfileId(!v || v === '__none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="External attendee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">External attendee</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!profileId && (
            <div className="flex flex-col gap-1.5">
              <Label>Name (external)</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane Smith — HSEQ consultant"
                required={!profileId}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Role / title</Label>
            <Input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Managing Director"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Add attendee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Output action dialog ─────────────────────────────────────────────────────

function ActionDialog({
  open,
  onOpenChange,
  reviewId,
  profiles,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reviewId: string
  profiles: ProfileOption[]
  editing: ActionRow | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [description, setDescription] = useState(editing?.description ?? '')
  const [assignedTo, setAssignedTo] = useState(editing?.assigned_to ?? '')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        description,
        assigned_to: assignedTo || null,
        due_date: dueDate || null,
      }
      const result = editing
        ? await updateReviewAction(editing.id, reviewId, payload)
        : await createReviewAction({ review_id: reviewId, ...payload })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(editing ? 'Action updated' : 'Output action added')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit output action' : 'Add decision / output action'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Decision / action</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was decided, and what will be done?"
              rows={3}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Assigned to</Label>
              <Select
                value={assignedTo}
                onValueChange={(v) => setAssignedTo(!v || v === '__none' ? '' : v)}
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
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save' : 'Add action'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Close confirm dialog (SOFT gate) ─────────────────────────────────────────

function CloseConfirmDialog({
  open,
  onOpenChange,
  unreviewed,
  onConfirm,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreviewed: { key: string; label: string }[]
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close with un-reviewed inputs?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {unreviewed.length} mandated input{unreviewed.length === 1 ? ' has' : 's have'}{' '}
            not been marked reviewed. An auditor reading this review will see they
            were not considered:
          </p>
          <ul className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3 text-sm">
            {unreviewed.map((u) => (
              <li key={u.key} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                {u.label}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Closing locks the minutes and freezes every data snapshot. Output
            actions stay open in the tracker and can still be completed.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep working
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Closing…' : 'Close anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function ReviewDetailClient({
  review,
  inputs,
  attendees,
  actions,
  role,
  profiles,
  auditHistory,
  today,
}: {
  review: ReviewDetailData
  inputs: InputRow[]
  attendees: AttendeeRow[]
  actions: ActionRow[]
  role: Role
  profiles: ProfileOption[]
  auditHistory: AuditRow[]
  today: string
}) {
  const router = useRouter()
  const canManage = role === 'admin' || role === 'office'
  const locked = review.status === 'closed'
  const [editOpen, setEditOpen] = useState(false)
  const [attendeeOpen, setAttendeeOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<ActionRow | null>(null)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [unreviewed, setUnreviewed] = useState<{ key: string; label: string }[]>([])
  const [generalMinutes, setGeneralMinutes] = useState(review.general_minutes ?? '')
  const [mutating, startMutation] = useTransition()

  const reviewedCount = inputs.filter((i) => i.reviewed).length

  function handleClose(confirm: boolean) {
    startMutation(async () => {
      const result = await closeReview(review.id, { confirm })
      if (result.unreviewed && result.unreviewed.length > 0 && !confirm) {
        // The SOFT gate: show exactly which inputs are un-reviewed.
        setUnreviewed(result.unreviewed)
        setCloseConfirmOpen(true)
        return
      }
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${review.number} closed — minutes locked`)
      setCloseConfirmOpen(false)
      router.refresh()
    })
  }

  function handleReopen() {
    startMutation(async () => {
      const result = await reopenReview(review.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Review reopened')
      router.refresh()
    })
  }

  function handleDelete() {
    if (!window.confirm(`Delete ${review.number}? This removes its inputs and minutes.`)) {
      return
    }
    startMutation(async () => {
      const result = await deleteReview(review.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Review deleted')
      router.push('/whs/reviews')
    })
  }

  function saveGeneralMinutes() {
    startMutation(async () => {
      const result = await updateReview(review.id, {
        general_minutes: generalMinutes || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('General minutes saved')
      router.refresh()
    })
  }

  function handleActionDone(action: ActionRow, done: boolean) {
    startMutation(async () => {
      const result = await setReviewActionDone(action.id, review.id, done)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleActionDelete(action: ActionRow) {
    if (!window.confirm('Delete this output action?')) return
    startMutation(async () => {
      const result = await deleteReviewAction(action.id, review.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleAttendeeRemove(attendee: AttendeeRow) {
    if (!window.confirm(`Remove ${attendee.name} from the attendee record?`)) return
    startMutation(async () => {
      const result = await removeAttendee(attendee.id, review.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              <span className="font-mono text-muted-foreground">{review.number}</span>{' '}
              Management Review
            </h2>
            <StatusBadge status={review.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {fmtDate(review.review_date)}
            {review.period_covered ? ` · Covers ${review.period_covered}` : ''}
            {review.chair_name ? ` · Chaired by ${review.chair_name}` : ''}
            {review.closed_at ? ` · Closed ${fmtDate(review.closed_at)}` : ''}
            {' · '}
            <span className={reviewedCount === inputs.length ? '' : 'text-amber-600 dark:text-amber-400'}>
              {reviewedCount}/{inputs.length} inputs reviewed
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Conducted per the{' '}
            <Link href="/documents" className="underline underline-offset-2 hover:text-foreground">
              Management Review Procedure (SMS-08)
            </Link>{' '}
            — quarterly, with a full annual system review — ISO 9001/14001/45001 §9.3.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/pdf/mgmt-review/${review.id}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline">
              <FileTextIcon className="size-4" />
              Report PDF
            </Button>
          </a>
          {canManage && !locked && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon className="size-4" />
                Edit
              </Button>
              <Button size="sm" onClick={() => handleClose(false)} disabled={mutating}>
                <LockIcon className="size-4" />
                Close review
              </Button>
            </>
          )}
          {role === 'admin' && locked && (
            <Button size="sm" variant="outline" onClick={handleReopen} disabled={mutating}>
              <UnlockIcon className="size-4" />
              Reopen
            </Button>
          )}
          {role === 'admin' && !locked && (
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={mutating}>
              <Trash2Icon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {locked && (
        <p className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
          This review is closed — the minutes and data snapshots are locked as
          evidence. Output actions below can still be completed as the work
          lands.
        </p>
      )}

      {/* Attendees */}
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Attendees</CardTitle>
            {canManage && !locked && (
              <Button size="sm" variant="outline" onClick={() => setAttendeeOpen(true)}>
                <PlusIcon className="size-4" />
                Add attendee
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {attendees.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No attendees recorded — add everyone present so the review evidences
              top-management participation.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {attendees.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <span>{a.name}</span>
                  {a.role_title && (
                    <span className="text-xs text-muted-foreground">{a.role_title}</span>
                  )}
                  {a.external && (
                    <span className="rounded border px-1 text-[10px] text-muted-foreground">
                      External
                    </span>
                  )}
                  {role === 'admin' && !locked && (
                    <button
                      type="button"
                      title="Remove"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleAttendeeRemove(a)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inputs checklist */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">
            Review inputs — ISO 9.3.2 ({reviewedCount}/{inputs.length} reviewed)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {inputs.map((input) => (
            <InputItem
              key={input.id}
              input={input}
              reviewId={review.id}
              locked={locked}
              canManage={canManage}
            />
          ))}
        </CardContent>
      </Card>

      {/* General minutes */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">General minutes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {canManage && !locked ? (
            <>
              <Textarea
                value={generalMinutes}
                onChange={(e) => setGeneralMinutes(e.target.value)}
                placeholder="Anything discussed outside the mandated inputs — general business, follow-ups, next review cadence…"
                rows={4}
              />
              {generalMinutes !== (review.general_minutes ?? '') && (
                <div>
                  <Button size="sm" variant="outline" onClick={saveGeneralMinutes} disabled={mutating}>
                    Save minutes
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm">
              {review.general_minutes ?? (
                <span className="text-muted-foreground">No general minutes recorded.</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Outputs — decisions & actions */}
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              Outputs — decisions &amp; actions (ISO 9.3.3)
            </CardTitle>
            {canManage && !locked && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingAction(null)
                  setActionOpen(true)
                }}
              >
                <PlusIcon className="size-4" />
                Add action
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No output actions yet. Record every decision on improvement,
              system changes and resource needs as a dated, owned action.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {actions.map((a) => {
                const overdue =
                  a.status === 'open' && a.due_date != null && a.due_date < today
                return (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={cn(
                          'text-sm',
                          a.status === 'done' && 'text-muted-foreground line-through'
                        )}
                      >
                        {a.description}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.assigned_to_name ?? 'Unassigned'}
                        {a.due_date ? (
                          <>
                            {' · due '}
                            <span className={overdue ? 'font-medium text-red-600 dark:text-red-400' : ''}>
                              {fmtDate(a.due_date)}
                            </span>
                          </>
                        ) : (
                          ''
                        )}
                        {a.status === 'done' && a.completed_at
                          ? ` · done ${fmtDate(a.completed_at)}`
                          : ''}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusBadge status={a.status} />
                      {canManage && a.status === 'open' && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Mark done"
                          onClick={() => handleActionDone(a, true)}
                          disabled={mutating}
                        >
                          <CheckIcon className="size-4" />
                        </Button>
                      )}
                      {canManage && a.status === 'open' && !locked && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Edit"
                          onClick={() => {
                            setEditingAction(a)
                            setActionOpen(true)
                          }}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      )}
                      {canManage && a.status === 'done' && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Reopen"
                          onClick={() => handleActionDone(a, false)}
                          disabled={mutating}
                        >
                          <UndoIcon className="size-4" />
                        </Button>
                      )}
                      {role === 'admin' && !locked && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Delete"
                          onClick={() => handleActionDelete(a)}
                          disabled={mutating}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit history */}
      <AuditHistory rows={auditHistory} />

      <EditReviewDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        review={review}
        profiles={profiles}
      />
      <AttendeeDialog
        open={attendeeOpen}
        onOpenChange={setAttendeeOpen}
        reviewId={review.id}
        profiles={profiles}
      />
      {actionOpen && (
        <ActionDialog
          key={editingAction?.id ?? 'new'}
          open={actionOpen}
          onOpenChange={setActionOpen}
          reviewId={review.id}
          profiles={profiles}
          editing={editingAction}
        />
      )}
      <CloseConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        unreviewed={unreviewed}
        onConfirm={() => handleClose(true)}
        pending={mutating}
      />
    </div>
  )
}
