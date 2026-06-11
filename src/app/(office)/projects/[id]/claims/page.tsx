import { requireRole } from '@/lib/auth'
import { EmptyState } from '@/components/EmptyState'
import { ReceiptIcon } from 'lucide-react'

export default async function ProjectClaimsPage() {
  await requireRole('admin', 'office')

  return (
    <EmptyState
      icon={<ReceiptIcon className="size-8" />}
      title="Progress claims land in the next build step"
      description="Draft, submit and certify monthly payment claims here."
    />
  )
}
