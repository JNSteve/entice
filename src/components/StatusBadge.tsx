import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type StatusMeta = {
  label: string
  className: string
}

const STATUS_META: Record<string, StatusMeta> = {
  // Gray / neutral
  draft:               { label: 'Draft',               className: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300' },
  void:                { label: 'Void',                className: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 line-through' },
  superseded:          { label: 'Superseded',          className: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400' },
  planned:             { label: 'Planned',             className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300' },
  idle:                { label: 'Idle',                className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300' },

  // Blue / in-progress
  sent:                { label: 'Sent',                className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  submitted:           { label: 'Submitted',           className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  issued:              { label: 'Issued',              className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  in_progress:         { label: 'In Progress',         className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  working:             { label: 'Working',             className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  invited:             { label: 'Invited',             className: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  scheduled:           { label: 'Scheduled',           className: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },
  rfq_out:             { label: 'RFQ Out',             className: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300' },

  // Amber / pending / attention
  notified:            { label: 'Notified',            className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  priced:              { label: 'Priced',              className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  quotes_in:           { label: 'Quotes In',           className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  recommended:         { label: 'Recommended',         className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  quoted:              { label: 'Quoted',              className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  quote:               { label: 'Quote',               className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },
  defects_liability:   { label: 'Defects Liability',   className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300' },

  // Green / success
  accepted:            { label: 'Accepted',            className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  approved:            { label: 'Approved',            className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  awarded:             { label: 'Awarded',             className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  paid:                { label: 'Paid',                className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  completed:           { label: 'Completed',           className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  active:              { label: 'Active',              className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  invoiced:            { label: 'Invoiced',            className: 'bg-green-50 text-green-600 border-green-200 dark:bg-green-950 dark:text-green-300' },
  certified:           { label: 'Certified',           className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  released:            { label: 'Released',            className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },
  practical_completion:{ label: 'Practical Completion',className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300' },

  // Red / bad
  lost:                { label: 'Lost',                className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300' },
  rejected:            { label: 'Rejected',            className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300' },
  cancelled:           { label: 'Cancelled',           className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300' },
  declined:            { label: 'Declined',            className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300' },
  down:                { label: 'Down',                className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300' },
  pending:             { label: 'Pending',             className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300' },

  // Purple / closed
  closed:              { label: 'Closed',              className: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300' },
}

function humanise(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status]
  const label = meta?.label ?? humanise(status)
  const className = meta?.className ?? 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300'

  return (
    <Badge
      className={cn(
        'border font-medium',
        className,
      )}
      variant="outline"
    >
      {label}
    </Badge>
  )
}
