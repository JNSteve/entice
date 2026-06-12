import { FileCheckIcon } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function WhsSubbieSWMSPage() {
  return (
    <EmptyState
      icon={<FileCheckIcon className="size-8" />}
      title="Subbie SWMS register"
      description="Subcontractor SWMS tracking lands in the next build step."
    />
  )
}
