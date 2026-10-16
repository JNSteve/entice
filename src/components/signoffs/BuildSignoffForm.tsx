'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildSignoff } from '@/lib/signoff-actions'
import { yesterdayAU } from '@/lib/tz'

export function BuildSignoffForm({ kind, workId }: { kind: 'job' | 'project'; workId: string }) {
  const router = useRouter()
  const [date, setDate] = useState(() => yesterdayAU())
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date) {
      toast.error('Pick a date')
      return
    }
    startTransition(async () => {
      const res = await buildSignoff(kind, workId, date)
      if (res.error || !res.id) {
        toast.error(res.error ?? 'Could not build the snapshot')
        return
      }
      toast.success('Snapshot built')
      router.push(`/signoffs/${res.id}`)
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-auto"
        aria-label="Sign-off date"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Building…' : 'Build snapshot'}
      </Button>
    </form>
  )
}
