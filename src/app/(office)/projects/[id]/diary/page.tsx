import { requireRole } from '@/lib/auth'
import { EmptyState } from '@/components/EmptyState'
import { BookOpenIcon } from 'lucide-react'

export default async function ProjectDiaryPage() {
  await requireRole('admin', 'office', 'supervisor')

  return (
    <EmptyState
      icon={<BookOpenIcon className="size-8" />}
      title="Site diary lands in the next build step"
      description="Daily weather, labour, plant and work records will live here."
    />
  )
}
