import { AlertTriangleIcon } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function WhsIncidentsPage() {
  return (
    <EmptyState
      icon={<AlertTriangleIcon className="size-8" />}
      title="Incident register"
      description="Incident tracking lands in the next build step."
    />
  )
}
