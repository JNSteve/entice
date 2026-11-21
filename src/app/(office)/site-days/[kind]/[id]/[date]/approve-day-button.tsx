'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DayRef } from '@/lib/site-days'
import { approveDay } from '@/app/(office)/site-days/actions'

/**
 * `entryIds` are the closed, unapproved entries shown on the page. Only those
 * are approved, so an entry closed after the page loaded is never approved
 * unseen.
 */
export function ApproveDayButton({ dayRef, entryIds }: { dayRef: DayRef; entryIds: string[] }) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const result = await approveDay(dayRef, entryIds)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Hours approved')
    })
  }

  return (
    <Button onClick={onClick} disabled={pending || entryIds.length === 0}>
      <CheckCheckIcon />
      {pending ? 'Approving…' : 'Approve day'}
    </Button>
  )
}
