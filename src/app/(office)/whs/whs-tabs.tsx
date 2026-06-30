'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type Tab = {
  label: string
  href: string
}

// NOTE: the "Documents" tab was removed when the WHS-only document library was
// generalised into the company-wide controlled document register at the
// top-level /documents (sidebar nav). The old whs/documents route was deleted.
const TABS: Tab[] = [
  { label: 'Overview', href: '/whs' },
  { label: 'Forms', href: '/whs/forms' },
  { label: 'Incidents', href: '/whs/incidents' },
  { label: 'Subbie SWMS', href: '/whs/subbie-swms' },
  { label: 'Audit', href: '/whs/audit' },
]

export function WhsTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        const active =
          tab.href === '/whs'
            ? pathname === '/whs'
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
