'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BriefcaseIcon, HardHatIcon, SunIcon, WrenchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'My Day', href: '/field', icon: SunIcon },
  { label: 'Jobs', href: '/field/jobs', icon: BriefcaseIcon },
  { label: 'Safety', href: '/field/safety', icon: HardHatIcon },
  { label: 'Maintenance', href: '/field/maintenance', icon: WrenchIcon },
]

function isActive(href: string, pathname: string): boolean {
  if (href === '/field') return pathname === '/field'
  if (pathname === href || pathname.startsWith(`${href}/`)) return true
  // The job screen lives under /field/work but belongs to Jobs.
  if (href === '/field/jobs') return pathname.startsWith('/field/work/')
  // SWMS sign pages and waste-load logging belong to Safety.
  if (href === '/field/safety') {
    return pathname.startsWith('/field/swms') || pathname.startsWith('/field/waste')
  }
  return false
}

export function FieldTabs() {
  const pathname = usePathname()

  return (
    // pb clears the iPhone home indicator, which otherwise sits over the last
    // tab in standalone mode.
    <nav className="sticky bottom-0 z-30 mx-auto w-full max-w-md border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active = isActive(tab.href, pathname)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors',
                active
                  ? 'text-primary before:absolute before:inset-x-0 before:top-0 before:mx-auto before:h-0.5 before:w-8 before:rounded-full before:bg-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-5" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
