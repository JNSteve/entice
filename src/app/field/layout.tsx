import { LogOutIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth'
import { signOut } from '@/lib/auth-actions'
import { FieldTabs } from './field-tabs'

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireRole('admin', 'office', 'supervisor', 'field')
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name

  return (
    // min-h-dvh, not min-h-screen: on mobile Safari/Chrome the URL bar
    // collapses on scroll and 100vh overshoots, leaving a dead strip.
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col">
      {/* The navy bleeds up behind the status bar (viewport-fit: cover), while
          the inner row is pushed clear of the notch. */}
      <header className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* Navy logo on the navy field header — sits seamlessly. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://zspauxavbhtutanhekuu.supabase.co/storage/v1/object/public/branding/logo.png"
              alt="Entice"
              className="h-7 w-auto max-w-[140px] shrink-0 object-contain"
            />
            <span className="truncate text-xs text-sidebar-foreground/70">
              {firstName}
            </span>
          </div>
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LogOutIcon />
              <span className="sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </header>

      {/* pb clears the tab bar plus whatever the home indicator occupies. */}
      <main className="flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <FieldTabs />
    </div>
  )
}
