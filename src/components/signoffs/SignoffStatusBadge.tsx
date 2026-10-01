import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const META: Record<string, { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  },
  released: {
    label: 'Awaiting client',
    className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  },
  signed: {
    label: 'Signed',
    className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  },
  disputed: {
    label: 'Disputed',
    className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  },
  superseded: {
    label: 'Replaced',
    className: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400',
  },
}

export function SignoffStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = META[status] ?? { label: status, className: '' }
  return (
    <Badge variant="outline" className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  )
}
