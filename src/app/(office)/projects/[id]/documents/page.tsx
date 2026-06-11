import { requireRole } from '@/lib/auth'
import { EmptyState } from '@/components/EmptyState'
import { FolderIcon } from 'lucide-react'

export default async function ProjectDocumentsPage() {
  await requireRole('admin', 'office', 'supervisor')

  return (
    <EmptyState
      icon={<FolderIcon className="size-8" />}
      title="Documents land in the next build step"
      description="Project photos and document uploads will live here."
    />
  )
}
