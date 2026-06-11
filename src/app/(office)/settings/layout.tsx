import { requireRole } from '@/lib/auth'

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Settings is admin only — guards every tab and nested route.
  await requireRole('admin')

  return <>{children}</>
}
