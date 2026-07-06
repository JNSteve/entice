'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type Tab = {
  label: string
  /** Path suffix below /projects/[id] ('' = overview). */
  suffix: string
  /** Money tabs are hidden from supervisors. */
  money?: boolean
}

const TABS: Tab[] = [
  { label: 'Overview', suffix: '' },
  { label: 'Programme', suffix: '/programme' },
  { label: 'Budget', suffix: '/budget', money: true },
  { label: 'POs', suffix: '/pos', money: true },
  { label: 'Variations', suffix: '/variations', money: true },
  { label: 'Claims', suffix: '/claims', money: true },
  { label: 'Procurement', suffix: '/procurement', money: true },
  { label: 'Diary', suffix: '/diary' },
  { label: 'WHS', suffix: '/whs' },
  { label: 'Quality', suffix: '/quality' },
  { label: 'Risk', suffix: '/risk' },
  { label: 'Environment', suffix: '/env' },
  { label: 'Documents', suffix: '/documents' },
]

export function ProjectTabs({
  projectId,
  showMoney,
}: {
  projectId: string
  showMoney: boolean
}) {
  const pathname = usePathname()
  const base = `/projects/${projectId}`
  const tabs = TABS.filter((t) => showMoney || !t.money)

  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const href = `${base}${t.suffix}`
        const active =
          t.suffix === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={t.suffix}
            href={href}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
