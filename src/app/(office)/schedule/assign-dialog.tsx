'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createAssignment, updateAssignment, deleteAssignment } from './actions'

export type SchedulableJob = {
  id: string
  number: string
  title: string
}

export type SchedulableProject = {
  id: string
  number: string
  name: string
}

export type AssignmentRecord = {
  id: string
  date: string
  user_id: string
  job_id: string | null
  project_id: string | null
  note: string | null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AssignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A key that changes each time the dialog opens, forcing form state reset */
  dialogKey: string
  userId: string
  defaultDate: string
  assignment?: AssignmentRecord
  jobs: SchedulableJob[]
  projects: SchedulableProject[]
}

// ─── Inner form — mounted with a fresh key each open ─────────────────────────

interface FormProps {
  userId: string
  defaultDate: string
  assignment?: AssignmentRecord
  jobs: SchedulableJob[]
  projects: SchedulableProject[]
  onClose: () => void
}

function AssignForm({
  userId,
  defaultDate,
  assignment,
  jobs,
  projects,
  onClose,
}: FormProps) {
  const isEdit = !!assignment

  const [targetType, setTargetType] = useState<'job' | 'project'>(
    assignment?.project_id ? 'project' : 'job'
  )
  const [targetId, setTargetId] = useState(
    assignment?.job_id ?? assignment?.project_id ?? ''
  )
  const [date, setDate] = useState(assignment?.date ?? defaultDate)
  const [repeatUntil, setRepeatUntil] = useState('')
  const [note, setNote] = useState(assignment?.note ?? '')

  const [pending, startTransition] = useTransition()
  const [deletePending, startDeleteTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!targetId) {
      toast.error('Select a job or project')
      return
    }

    startTransition(async () => {
      if (isEdit) {
        const result = await updateAssignment(assignment.id, {
          date,
          job_id: targetType === 'job' ? targetId : null,
          project_id: targetType === 'project' ? targetId : null,
          note: note || null,
        })
        if (result.error) { toast.error(result.error); return }
        toast.success('Assignment updated')
      } else {
        const result = await createAssignment({
          user_id: userId,
          date,
          job_id: targetType === 'job' ? targetId : null,
          project_id: targetType === 'project' ? targetId : null,
          note: note || null,
          repeat_until: repeatUntil || null,
        })
        if (result.error) { toast.error(result.error); return }
        const count = result.created ?? 0
        toast.success(
          count > 0
            ? `${count} assignment${count !== 1 ? 's' : ''} created`
            : 'Already assigned — skipped'
        )
      }
      onClose()
    })
  }

  function handleDelete() {
    if (!assignment || !confirm('Delete this assignment?')) return
    startDeleteTransition(async () => {
      const result = await deleteAssignment(assignment.id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Assignment deleted')
      onClose()
    })
  }

  const currentTargets = targetType === 'job' ? jobs : projects

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Target type radio */}
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer text-sm">
          <input
            type="radio"
            name="assign-target-type"
            value="job"
            checked={targetType === 'job'}
            onChange={() => { setTargetType('job'); setTargetId('') }}
            className="accent-primary"
          />
          Job
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-sm">
          <input
            type="radio"
            name="assign-target-type"
            value="project"
            checked={targetType === 'project'}
            onChange={() => { setTargetType('project'); setTargetId('') }}
            className="accent-primary"
          />
          Project
        </label>
      </div>

      {/* Target select */}
      <div className="flex flex-col gap-1.5">
        <Label>
          {targetType === 'job' ? 'Job' : 'Project'}{' '}
          <span className="text-destructive">*</span>
        </Label>
        <Select value={targetId} onValueChange={(v) => setTargetId(v ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={`Select a ${targetType === 'job' ? 'job' : 'project'}…`}
            />
          </SelectTrigger>
          <SelectContent>
            {currentTargets.length === 0 ? (
              <SelectItem value="__none" disabled>
                No schedulable {targetType === 'job' ? 'jobs' : 'projects'}
              </SelectItem>
            ) : (
              currentTargets.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.number} —{' '}
                  {'title' in t
                    ? (t as SchedulableJob).title
                    : (t as SchedulableProject).name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Date */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-date">
          Date <span className="text-destructive">*</span>
        </Label>
        <Input
          id="assign-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      {/* Repeat until — create only */}
      {!isEdit && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-repeat">
            Repeat until{' '}
            <span className="text-muted-foreground font-normal text-xs">
              (optional, max 14 days)
            </span>
          </Label>
          <Input
            id="assign-repeat"
            type="date"
            value={repeatUntil}
            onChange={(e) => setRepeatUntil(e.target.value)}
            min={date}
          />
        </div>
      )}

      {/* Note */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-note">Note</Label>
        <Textarea
          id="assign-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…"
          rows={2}
        />
      </div>

      <DialogFooter>
        {isEdit && (
          <Button
            type="button"
            variant="destructive"
            disabled={deletePending}
            onClick={handleDelete}
            className="mr-auto"
          >
            {deletePending ? 'Deleting…' : 'Delete'}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !targetId}>
          {pending
            ? isEdit ? 'Saving…' : 'Creating…'
            : isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─── AssignDialog (outer shell) ───────────────────────────────────────────────

export function AssignDialog({
  open,
  onOpenChange,
  dialogKey,
  userId,
  defaultDate,
  assignment,
  jobs,
  projects,
}: AssignDialogProps) {
  function close() { onOpenChange(false) }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {assignment ? 'Edit assignment' : 'New assignment'}
          </DialogTitle>
        </DialogHeader>
        {/* key forces a fresh mount (and fresh state) each time the dialog opens */}
        <AssignForm
          key={dialogKey}
          userId={userId}
          defaultDate={defaultDate}
          assignment={assignment}
          jobs={jobs}
          projects={projects}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  )
}
