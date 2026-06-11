'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { StatusBadge } from '@/components/StatusBadge'
import { PROJECT_STATUSES, type ProjectStatus } from '@/lib/zod'
import { updateProject } from '../actions'

const LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  practical_completion: 'Practical Completion',
  defects_liability: 'Defects Liability',
  closed: 'Closed',
}

/**
 * Status display + forward-only status select with confirm.
 * Transitions: active → practical_completion → defects_liability → closed.
 */
export function ProjectStatusSelect({
  projectId,
  status,
}: {
  projectId: string
  status: string
}) {
  const [pending, startTransition] = useTransition()
  const [confirmTarget, setConfirmTarget] = useState<ProjectStatus | null>(null)

  const currentIndex = PROJECT_STATUSES.indexOf(status as ProjectStatus)
  const nextStatus =
    currentIndex >= 0 && currentIndex < PROJECT_STATUSES.length - 1
      ? PROJECT_STATUSES[currentIndex + 1]
      : null

  function handleConfirm() {
    if (!confirmTarget) return
    const target = confirmTarget
    startTransition(async () => {
      const result = await updateProject(projectId, { status: target })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Project moved to ${LABELS[target]}`)
      setConfirmTarget(null)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={status} />
      {nextStatus && (
        <Select
          value={status}
          onValueChange={(v) => {
            if (v && v !== status) setConfirmTarget(v as ProjectStatus)
          }}
        >
          <SelectTrigger className="h-7 text-xs" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUSES.map((s, i) => (
              <SelectItem
                key={s}
                value={s}
                disabled={i !== currentIndex && i !== currentIndex + 1}
              >
                {LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Move project to {confirmTarget ? LABELS[confirmTarget] : ''}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmTarget === 'practical_completion'
              ? 'This sets the practical completion date to today (if not already set). Status transitions are forward-only and cannot be undone from the UI.'
              : 'Status transitions are forward-only and cannot be undone from the UI.'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={pending}>
              {pending ? 'Updating…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
