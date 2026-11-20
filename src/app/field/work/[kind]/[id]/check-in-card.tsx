'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { LogInIcon, LogOutIcon, RepeatIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkKind } from '@/lib/live-work'
import { fmtTimeAU } from '@/lib/field-today'
import { checkIn, checkOut, switchCheckIn } from '../../../actions'
import { useElapsed } from '../../../use-elapsed'

export function CheckInCard({
  kind,
  id,
  live,
  state,
  startAt,
  elsewhere,
}: {
  kind: WorkKind
  id: string
  /** False for work that is no longer live — no check-in is offered. */
  live: boolean
  state: 'here' | 'elsewhere' | 'none'
  /** Start of the open entry, when there is one. */
  startAt: string | null
  /** 'RJ26031 — Friable removal' when checked in on another job. */
  elsewhere: string | null
}) {
  const [pending, startTransition] = useTransition()
  const elapsed = useElapsed(state === 'here' ? startAt : null)
  const target = {
    job_id: kind === 'job' ? id : null,
    project_id: kind === 'project' ? id : null,
  }

  function run(action: () => Promise<{ error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action()
      if (result.error) toast.error(result.error)
      else toast.success(done)
    })
  }

  if (state === 'here' && startAt) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">
            Checked in {fmtTimeAU(startAt)}
          </p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">{elapsed}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-green-500/40 text-green-700 hover:bg-green-500/10 dark:text-green-400"
          onClick={() => run(checkOut, 'Checked out')}
          disabled={pending}
        >
          <LogOutIcon className="mr-1 size-3.5" />
          {pending ? 'Checking out…' : 'Check out'}
        </Button>
      </div>
    )
  }

  if (!live) {
    return (
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        This job is closed — hours can no longer be logged against it.
      </p>
    )
  }

  if (state === 'elsewhere') {
    return (
      <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Not checked in here</p>
          <p className="truncate text-xs text-muted-foreground">
            You&apos;re on {elsewhere}
            {startAt ? ` since ${fmtTimeAU(startAt)}` : ''}
          </p>
        </div>
        <Button
          className="w-full"
          onClick={() => run(() => switchCheckIn(target), 'Switched to this job')}
          disabled={pending}
        >
          <RepeatIcon className="mr-1 size-3.5" />
          {pending ? 'Switching…' : 'Switch to this job'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
      <p className="text-sm font-semibold">Not checked in</p>
      <Button
        className="w-full"
        onClick={() => run(() => checkIn(target), 'Checked in')}
        disabled={pending}
      >
        <LogInIcon className="mr-1 size-3.5" />
        {pending ? 'Checking in…' : 'Check in'}
      </Button>
    </div>
  )
}
