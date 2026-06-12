import { ClipboardCheckIcon } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function WhsAuditPage() {
  return (
    <EmptyState
      icon={<ClipboardCheckIcon className="size-8" />}
      title="WHS audit register"
      description="Audit tracking lands in the next build step."
    />
  )
}
