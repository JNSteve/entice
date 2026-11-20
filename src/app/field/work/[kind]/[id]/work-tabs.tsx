'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { workHref, workTabs, type WorkKind } from '@/lib/live-work'

export function WorkTabs({ kind, id }: { kind: WorkKind; id: string }) {
  const pathname = usePathname()
  const activeRef = useRef<HTMLAnchorElement>(null)
  const base = workHref(kind, id)

  // Seven tabs do not fit a phone; keep the active one in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none]">
      {workTabs(kind).map((t) => {
        const href = workHref(kind, id, t.tab)
        const active =
          t.tab === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={t.tab}
            href={href}
            ref={active ? activeRef : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
