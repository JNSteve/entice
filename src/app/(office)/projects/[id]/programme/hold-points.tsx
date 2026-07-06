'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import { deleteHoldPoint, setHoldPointStatus, upsertHoldPoint } from './actions'
import {
  HOLD_POINT_COLOUR,
  type HoldPoint,
  type ProgrammeTask,
} from './types'

// ─── Register ─────────────────────────────────────────────────────────────────

export function HoldPointsRegister({
  projectId,
  tasks,
  holdPoints,
  isAdmin,
  canDelete,
  onEdit,
  onAdd,
}: {
  projectId: string
  tasks: ProgrammeTask[]
  holdPoints: HoldPoint[]
  isAdmin: boolean
  canDelete: boolean
  onEdit: (hp: HoldPoint) => void
  onAdd: () => void
}) {
  const [release, setRelease] = useState<HoldPoint | null>(null)
  const [pending, startTransition] = useTransition()

  const todayIso = format(new Date(), 'yyyy-MM-dd')
  const taskName = (id: string) =>
    tasks.find((t) => t.id === id)?.name ?? '—'

  function markNotified(hp: HoldPoint) {
    startTransition(async () => {
      const res = await setHoldPointStatus(hp.id, projectId, 'notify')
      if (res.error) toast.error(res.error)
      else toast.success('Hold point marked notified')
    })
  }

  function reopen(hp: HoldPoint) {
    if (!confirm('Reopen this released hold point? It goes back to notified.'))
      return
    startTransition(async () => {
      const res = await setHoldPointStatus(hp.id, projectId, 'reopen')
      if (res.error) toast.error(res.error)
      else toast.success('Hold point reopened')
    })
  }

  function remove(hp: HoldPoint) {
    if (!confirm('Delete this hold point? This cannot be undone.')) return
    startTransition(async () => {
      const res = await deleteHoldPoint(hp.id, projectId)
      if (res.error) toast.error(res.error)
      else toast.success('Hold point deleted')
    })
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Hold points</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdd}
            disabled={tasks.length === 0}
          >
            <PlusIcon className="size-4" />
            Add hold point
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {holdPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hold points yet — add inspection or witness points against
            programme tasks.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hold point</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Required by</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdPoints.map((hp) => {
                  const overdue =
                    hp.status !== 'released' && hp.date < todayIso
                  return (
                    <TableRow key={hp.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'size-2 shrink-0 rotate-45 rounded-[1px]',
                              HOLD_POINT_COLOUR[hp.status]
                            )}
                          />
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {hp.title}
                            </span>
                            {hp.status === 'released' && hp.released_by && (
                              <span className="truncate text-xs text-muted-foreground">
                                Released by {hp.released_by}
                                {hp.release_ref ? ` · ${hp.release_ref}` : ''}
                                {hp.released_at
                                  ? ` · ${fmtDate(hp.released_at)}`
                                  : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {taskName(hp.task_id)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {hp.required_by}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'tabular-nums',
                          overdue &&
                            'font-medium text-red-600 dark:text-red-400'
                        )}
                      >
                        {fmtDate(hp.date)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={hp.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {hp.status === 'pending' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => markNotified(hp)}
                            >
                              Mark notified
                            </Button>
                          )}
                          {hp.status !== 'released' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => setRelease(hp)}
                            >
                              Release…
                            </Button>
                          )}
                          {hp.status === 'released' && isAdmin && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => reopen(hp)}
                            >
                              Reopen
                            </Button>
                          )}
                          {hp.status !== 'released' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Edit hold point"
                              disabled={pending}
                              onClick={() => onEdit(hp)}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Delete hold point"
                              disabled={pending}
                              onClick={() => remove(hp)}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {release && (
        <ReleaseDialog
          projectId={projectId}
          holdPoint={release}
          onClose={() => setRelease(null)}
        />
      )}
    </Card>
  )
}

// ─── Add / edit dialog ────────────────────────────────────────────────────────

export function HoldPointDialog({
  projectId,
  tasks,
  holdPoint,
  defaultTaskId,
  onClose,
}: {
  projectId: string
  tasks: ProgrammeTask[]
  holdPoint: HoldPoint | null
  defaultTaskId?: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()

  const initialTaskId = holdPoint?.task_id ?? defaultTaskId ?? tasks[0]?.id ?? ''
  const [taskId, setTaskId] = useState(initialTaskId)
  const [title, setTitle] = useState(holdPoint?.title ?? '')
  const [requiredBy, setRequiredBy] = useState(
    holdPoint?.required_by ?? 'Superintendent'
  )
  const [date, setDate] = useState(
    holdPoint?.date ??
      tasks.find((t) => t.id === initialTaskId)?.end_date ??
      format(new Date(), 'yyyy-MM-dd')
  )
  const [notes, setNotes] = useState(holdPoint?.notes ?? '')

  function handleTaskChange(id: string) {
    setTaskId(id)
    // New hold points default their date to the selected task's end.
    if (!holdPoint) {
      const t = tasks.find((x) => x.id === id)
      if (t) setDate(t.end_date)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await upsertHoldPoint({
        id: holdPoint?.id,
        project_id: projectId,
        task_id: taskId,
        title,
        required_by: requiredBy,
        date,
        notes: notes || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(holdPoint ? 'Hold point updated' : 'Hold point added')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {holdPoint ? 'Edit hold point' : 'New hold point'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hp-task">
              Task <span className="text-destructive">*</span>
            </Label>
            <Select value={taskId} onValueChange={(v) => v && handleTaskChange(v)}>
              <SelectTrigger id="hp-task" className="w-full">
                <SelectValue placeholder="Pick a task…" />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hp-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="hp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Subgrade inspection"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hp-required-by">
                Required by <span className="text-destructive">*</span>
              </Label>
              <Input
                id="hp-required-by"
                value={requiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hp-date">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="hp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hp-notes">Notes</Label>
            <Textarea
              id="hp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !title.trim() || !taskId}
            >
              {pending ? 'Saving…' : holdPoint ? 'Save changes' : 'Add hold point'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Release dialog ───────────────────────────────────────────────────────────
// Exported: the project Quality tab reuses this exact release flow for
// quality-origin (lot) hold points — one release dialog, one server action.

export function ReleaseDialog({
  projectId,
  holdPoint,
  onClose,
}: {
  projectId: string
  holdPoint: Pick<HoldPoint, 'id' | 'title'>
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [releasedBy, setReleasedBy] = useState('')
  const [releaseRef, setReleaseRef] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await setHoldPointStatus(holdPoint.id, projectId, 'release', {
        released_by: releasedBy,
        release_ref: releaseRef || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Hold point released')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Release hold point</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{holdPoint.title}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hp-released-by">
              Released by <span className="text-destructive">*</span>
            </Label>
            <Input
              id="hp-released-by"
              value={releasedBy}
              onChange={(e) => setReleasedBy(e.target.value)}
              placeholder="e.g. J. Smith — Superintendent"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hp-release-ref">Reference</Label>
            <Input
              id="hp-release-ref"
              value={releaseRef}
              onChange={(e) => setReleaseRef(e.target.value)}
              placeholder="e.g. HP-001-A"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !releasedBy.trim()}>
              {pending ? 'Releasing…' : 'Release'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
