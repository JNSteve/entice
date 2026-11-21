'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function DayPicker({
  date,
  today,
  yesterday,
}: {
  date: string
  today: string
  yesterday: string
}) {
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={date === today ? 'default' : 'outline'}
        size="sm"
        render={<Link href="/site-days" />}
      >
        Today
      </Button>
      <Button
        variant={date === yesterday ? 'default' : 'outline'}
        size="sm"
        render={<Link href={`/site-days?date=${yesterday}`} />}
      >
        Yesterday
      </Button>
      <Input
        type="date"
        value={date}
        max={today}
        onChange={(e) => {
          if (e.target.value) router.push(`/site-days?date=${e.target.value}`)
        }}
        className="w-auto"
        aria-label="Day"
      />
    </div>
  )
}
