import { cn } from '@/lib/utils'
import {
  COMPETENCY_STATUS_LABELS,
  type MatrixCellStatus,
} from '@/lib/competency'

const DOT_COLOURS: Record<MatrixCellStatus, string> = {
  current: 'bg-green-500',
  expiring: 'bg-amber-400',
  expired: 'bg-red-500',
  missing: 'bg-gray-300 dark:bg-gray-600',
}

/**
 * Competency expiry traffic light: current green / expiring ≤30d amber /
 * expired red / missing grey. `title` overrides the default status label
 * (e.g. to include the expiry date).
 */
export function CompetencyLight({
  status,
  title,
  className,
}: {
  status: MatrixCellStatus
  title?: string
  className?: string
}) {
  const label = title ?? COMPETENCY_STATUS_LABELS[status]
  return (
    <span
      className={cn('inline-block size-3 rounded-full', DOT_COLOURS[status], className)}
      title={label}
      aria-label={label}
    />
  )
}
