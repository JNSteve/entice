'use client'

import { useEffect, useRef, useState } from 'react'

/** '3h 18m 04s' since `startAt`, ticking every second; '' when there is no start. */
export function useElapsed(startAt: string | null): string {
  const [elapsed, setElapsed] = useState('')
  const interval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!startAt) return

    function tick() {
      const start = new Date(startAt!).getTime()
      const diff = Math.max(0, Date.now() - start)
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setElapsed(`${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`)
    }

    tick()
    interval.current = setInterval(tick, 1000)
    return () => {
      if (interval.current) clearInterval(interval.current)
    }
  }, [startAt])

  return elapsed
}
