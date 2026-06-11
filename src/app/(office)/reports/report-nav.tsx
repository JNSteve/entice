import Link from 'next/link'
import { cn } from '@/lib/utils'

export const REPORT_TABS = [
  { value: 'profitability', label: 'Profitability' },
  { value: 'wip', label: 'WIP' },
  { value: 'quote-conversion', label: 'Quote conversion' },
  { value: 'outstanding', label: 'Outstanding money' },
  { value: 'timesheets', label: 'Timesheets' },
] as const

export type ReportKey = (typeof REPORT_TABS)[number]['value']

/** Money reports are admin/office only; timesheets is also for supervisors. */
export function visibleReports(isSupervisor: boolean) {
  return isSupervisor
    ? REPORT_TABS.filter((t) => t.value === 'timesheets')
    : REPORT_TABS
}

export function ReportNav({
  active,
  isSupervisor,
}: {
  active: ReportKey
  isSupervisor: boolean
}) {
  const tabs = visibleReports(isSupervisor)

  return (
    <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <Link
          key={t.value}
          href={
            t.value === 'profitability' ? '/reports' : `/reports?report=${t.value}`
          }
          className={cn(
            'whitespace-nowrap rounded-md px-3 py-1 text-sm transition-colors',
            active === t.value
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
