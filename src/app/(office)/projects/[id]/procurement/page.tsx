import { requireRole } from '@/lib/auth'
import { EmptyState } from '@/components/EmptyState'
import { PackageIcon } from 'lucide-react'

export default async function ProjectProcurementPage() {
  await requireRole('admin', 'office')

  return (
    <EmptyState
      icon={<PackageIcon className="size-8" />}
      title="Procurement lands in the next build step"
      description="Trade packages, RFQs and award recommendations will live here."
    />
  )
}
