import { requireRole } from '@/lib/auth'
import { OfficeShell } from './office-shell'

export default async function OfficeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  return <OfficeShell profile={profile}>{children}</OfficeShell>
}
