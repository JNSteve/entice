'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CameraIcon,
  HardHatIcon,
  NotebookPenIcon,
  SunIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'My Day', href: '/field', icon: SunIcon },
  { label: 'Diary', href: '/field/diary', icon: NotebookPenIcon },
  { label: 'Safety', href: '/field/safety', icon: HardHatIcon },
  { label: 'Photos', href: '/field/photo', icon: CameraIcon },
]

export function FieldTabs() {
  const pathname = usePathname()

  return (
    <nav className="sticky bottom-0 z-30 mx-auto w-full max-w-md border-t bg-background">
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active =
            tab.href === '/field'
              ? pathname === '/field'
              : pathname === tab.href ||
                pathname.startsWith(`${tab.href}/`) ||
                // SWMS pages live under /field/swms but belong to Safety;
                // waste-load logging lives under /field/waste, same home.
                (tab.href === '/field/safety' &&
                  (pathname.startsWith('/field/swms') ||
                    pathname.startsWith('/field/waste')))
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
