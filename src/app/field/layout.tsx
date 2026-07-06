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
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-1 flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          {/* Navy logo on the navy field header — sits seamlessly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://zspauxavbhtutanhekuu.supabase.co/storage/v1/object/public/branding/logo.png"
            alt="Entice"
            className="h-7 w-auto max-w-[140px] object-contain"
          />
          <span className="text-xs text-sidebar-foreground/70">{firstName}</span>
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
      </header>

      <main className="flex-1 p-4 pb-20">{children}</main>

      <FieldTabs />
    </div>
  )
}
