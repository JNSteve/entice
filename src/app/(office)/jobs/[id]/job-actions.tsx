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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { scheduleJob, setJobStatus } from '../actions'

interface StatusActionsProps {
  jobId: string
  status: string
  scheduledStart: string | null
}

export function StatusActions({ jobId, status, scheduledStart }: StatusActionsProps) {
  const [pending, startTransition] = useTransition()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [lostConfirmOpen, setLostConfirmOpen] = useState(false)
  const [startDate, setStartDate] = useState(scheduledStart ?? '')
  const [endDate, setEndDate] = useState('')

  function doTransition(target: string, extra?: Record<string, unknown>) {
    startTransition(async () => {
      const result = await setJobStatus(jobId, { status: target, ...extra })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Job marked as ${target.replace('_', ' ')}`)
    })
  }

  function handleMarkScheduled() {
    if (!scheduledStart) {
      setScheduleOpen(true)
    } else {
      doTransition('scheduled')
    }
  }

  function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!startDate) {
      toast.error('Start date is required')
      return
    }
    // scheduleJob sets both dates, flips quote → scheduled, and pushes the
    // schedule into any linked portal request.
    startTransition(async () => {
      const result = await scheduleJob(jobId, {
        scheduled_start: startDate,
        scheduled_end: endDate || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Job scheduled')
      setScheduleOpen(false)
    })
  }

  const preCompleted = ['quote', 'scheduled', 'in_progress'].includes(status)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'quote' && (
        <Button onClick={handleMarkScheduled} disabled={pending}>
          Mark scheduled
        </Button>
      )}
      {status === 'scheduled' && (
        <Button onClick={() => doTransition('in_progress')} disabled={pending}>
          Start job
        </Button>
      )}
      {status === 'in_progress' && (
        <Button onClick={() => doTransition('completed')} disabled={pending}>
          Mark completed
        </Button>
      )}
      {preCompleted && (
        <Button
          variant="outline"
          className="text-destructive border-destructive/50 hover:bg-destructive/10"
          onClick={() => setLostConfirmOpen(true)}
          disabled={pending}
        >
          Mark lost
        </Button>
      )}

      {/* Schedule date dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleScheduleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched-start">Start date</Label>
              <Input
                id="sched-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched-end">End date (optional)</Label>
              <Input
                id="sched-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Scheduling…' : 'Schedule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Lost confirm dialog */}
      <Dialog open={lostConfirmOpen} onOpenChange={setLostConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark job as lost?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will mark the job as lost. This action cannot be undone from the UI.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setLostConfirmOpen(false)
                doTransition('lost')
              }}
            >
              {pending ? 'Marking…' : 'Mark lost'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
