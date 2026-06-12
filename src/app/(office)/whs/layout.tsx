import { requireRole } from '@/lib/auth'
import { WhsTabs } from './whs-tabs'

export default async function WhsLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin', 'office', 'supervisor')

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0">
        <h1 className="text-2xl font-semibold tracking-tight pb-4">WHS</h1>
        <WhsTabs />
      </div>
      <div>{children}</div>
    </div>
  )
}
