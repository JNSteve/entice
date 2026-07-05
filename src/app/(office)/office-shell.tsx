'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3Icon,
  BriefcaseIcon,
  CalendarIcon,
  ChevronDownIcon,
  DollarSignIcon,
  FileTextIcon,
  FolderClosedIcon,
  FolderKanbanIcon,
  HardHatIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TruckIcon,
  UsersIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { signOut } from '@/lib/auth-actions'
import type { Profile, Role } from '@/lib/auth'
import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** When set, only these roles see the item. */
  roles?: Role[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboardIcon },
  { label: 'Clients', href: '/clients', icon: UsersIcon },
  { label: 'Requests', href: '/clients/requests', icon: InboxIcon, roles: ['admin', 'office', 'supervisor'] },
  { label: 'Quotes', href: '/quotes', icon: FileTextIcon, roles: ['admin', 'office'] },
  { label: 'Jobs', href: '/jobs', icon: BriefcaseIcon },
  { label: 'Projects', href: '/projects', icon: FolderKanbanIcon },
  { label: 'Suppliers', href: '/vendors', icon: TruckIcon },
  { label: 'Schedule', href: '/schedule', icon: CalendarIcon },
  { label: 'WHS', href: '/whs', icon: ShieldCheckIcon, roles: ['admin', 'office', 'supervisor'] },
  { label: 'Documents', href: '/documents', icon: FolderClosedIcon, roles: ['admin', 'office', 'supervisor'] },
  { label: 'Money', href: '/money', icon: DollarSignIcon, roles: ['admin', 'office'] },
  { label: 'Reports', href: '/reports', icon: BarChart3Icon, roles: ['admin', 'office', 'supervisor'] },
  { label: 'Settings', href: '/settings', icon: SettingsIcon, roles: ['admin'] },
]

function NavLinks({
  role,
  onNavigate,
}: {
  role: Role
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const items = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role)
  )

  // Longest matching href wins so nested items (/clients/requests) don't also
  // light up their parent (/clients).
  const activeHref = items.reduce<string | null>((best, item) => {
    const matches =
      item.href === '/'
        ? pathname === '/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    if (!matches) return best
    return best === null || item.href.length > best.length ? item.href : best
  }, null)

  return (
    <nav className="flex flex-col gap-1 px-2">
      {items.map((item) => {
        const active = item.href === activeHref
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function SidebarHeader() {
  return (
    <div className="flex h-14 items-center gap-2 border-b px-4">
      <span className="text-lg font-bold tracking-tight">Entice</span>
    </div>
  )
}

function UserMenu({ profile }: { profile: Profile }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="gap-2">
            <span className="max-w-32 truncate">{profile.full_name}</span>
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span className="truncate text-foreground">{profile.full_name}</span>
          <Badge variant="secondary" className="capitalize">
            {profile.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/field" />}>
          <HardHatIcon className="size-4" />
          Field view
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem
            render={<button type="submit" className="w-full" />}
          >
            <LogOutIcon className="size-4" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function OfficeShell({
  profile,
  children,
}: {
  profile: Profile
  children: React.ReactNode
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-1">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-background md:flex">
        <SidebarHeader />
        <div className="flex-1 overflow-y-auto py-3">
          <NavLinks role={profile.role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-56">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background px-4">
          <div className="flex items-center gap-2">
            {/* Mobile nav trigger */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" className="md:hidden" />
                }
              >
                <MenuIcon />
                <span className="sr-only">Open navigation</span>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 gap-0 p-0">
                <SheetHeader className="h-14 justify-center border-b">
                  <SheetTitle className="text-lg font-bold tracking-tight">
                    Entice
                  </SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto py-3">
                  <NavLinks
                    role={profile.role}
                    onNavigate={() => setMobileNavOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <span className="text-lg font-bold tracking-tight md:hidden">
              Entice
            </span>
          </div>
          <UserMenu profile={profile} />
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
