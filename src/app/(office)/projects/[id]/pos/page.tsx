import { requireRole } from '@/lib/auth'
import { EmptyState } from '@/components/EmptyState'
import { FileTextIcon } from 'lucide-react'

export default async function ProjectPosPage() {
  await requireRole('admin', 'office')

  return (
    <EmptyState
      icon={<FileTextIcon className="size-8" />}
      title="Purchase orders land in the next build step"
      description="You will be able to raise, issue and track POs against this project here."
    />
  )
}
