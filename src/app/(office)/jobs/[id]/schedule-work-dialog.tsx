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
import { CalendarClockIcon } from 'lucide-react'
import { scheduleJob } from '../actions'

/**
 * The visible "Schedule work" affordance on the job page. Sets start/end in
 * one step, flips quote → scheduled when needed, and (server-side) pushes the
 * date into any linked portal work request so the client sees it.
 */
export function ScheduleWorkDialog({
  jobId,
  status,
  scheduledStart,
  scheduledEnd,
}: {
  jobId: string
  status: string
  scheduledStart: string | null
  scheduledEnd: string | null
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [start, setStart] = useState(scheduledStart ?? '')
  const [end, setEnd] = useState(scheduledEnd ?? '')

  if (status === 'completed' || status === 'lost') return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!start) {
      toast.error('Pick a start date')
      return
    }
    startTransition(async () => {
      const result = await scheduleJob(jobId, {
        scheduled_start: start,
        scheduled_end: end || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Work scheduled — visible in the client portal')
      setOpen(false)
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClockIcon className="size-4" />
        {scheduledStart ? 'Reschedule work' : 'Schedule work'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule work</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The schedule shows on the client&apos;s portal — both on the
              property&apos;s works and on any request this job came from.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sw-start">Start</Label>
                <Input
                  id="sw-start"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sw-end">
                  End <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="sw-end"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !start}>
                {pending ? 'Scheduling…' : 'Schedule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
