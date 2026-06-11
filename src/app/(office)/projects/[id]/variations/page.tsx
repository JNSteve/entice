import { requireRole } from '@/lib/auth'
import { EmptyState } from '@/components/EmptyState'
import { GitBranchIcon } from 'lucide-react'

export default async function ProjectVariationsPage() {
  await requireRole('admin', 'office')

  return (
    <EmptyState
      icon={<GitBranchIcon className="size-8" />}
      title="Variations land in the next build step"
      description="The variations register with time-bar tracking will live here."
    />
  )
}
