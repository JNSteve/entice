import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import type { FieldSwmsItem, SwmsSignState } from '@/lib/swms-queries'

function StateChip({ state, version }: { state: SwmsSignState; version: number }) {
  if (state === 'signed') {
    return (
      <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        Signed v{version}
      </span>
    )
  }
  if (state === 'resign') {
    return (
      <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        Re-sign required
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      Needs signature
    </span>
  )
}

/** Touch card linking to the field SWMS read-and-sign page. */
export function FieldSwmsCard({ item }: { item: FieldSwmsItem }) {
  return (
    <Link
      href={`/field/swms/${item.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">
          {item.title}{' '}
          <span className="font-normal text-muted-foreground">v{item.version}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {item.parentLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StateChip state={item.state} version={item.version} />
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </div>
    </Link>
  )
}
