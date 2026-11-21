'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DayRef } from '@/lib/site-days'
import { approveDay } from '@/app/(office)/site-days/actions'

export function ApproveDayButton({ dayRef, todo }: { dayRef: DayRef; todo: number }) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const result = await approveDay(dayRef)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Hours approved')
    })
  }

  return (
    <Button onClick={onClick} disabled={pending || todo === 0}>
      <CheckCheckIcon />
      {pending ? 'Approving…' : 'Approve day'}
    </Button>
  )
}
