import { SunIcon } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

export default function MyDayPage() {
  return (
    <EmptyState
      icon={<SunIcon className="size-8" />}
      title="No assignments today"
      description="Your scheduled work will show up here."
    />
  )
}
