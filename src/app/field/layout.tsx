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
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4">
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-tight">Entice</span>
          <span className="text-xs text-muted-foreground">{firstName}</span>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon">
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
