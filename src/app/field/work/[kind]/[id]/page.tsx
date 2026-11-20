import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  CameraIcon,
  ChevronRightIcon,
  FileCheckIcon,
  MapPinIcon,
  NotebookPenIcon,
  PackageIcon,
  PhoneIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { parseWorkKind, workHref } from '@/lib/live-work'
import { todayRows, type TodayRow } from '@/lib/field-today'
import { fetchTodayStatus, fetchWorkHeader } from '@/lib/field-work-queries'

const ROW_ICONS: Record<TodayRow['key'], React.ComponentType<{ className?: string }>> = {
  prestart: ShieldCheckIcon,
  swms: FileCheckIcon,
  day: PackageIcon,
  diary: NotebookPenIcon,
  photos: CameraIcon,
}

const TONE_CLASS: Record<TodayRow['tone'], string> = {
  ok: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  neutral: 'border-transparent bg-muted text-muted-foreground',
}

export default async function WorkTodayPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const [header, status] = await Promise.all([
    fetchWorkHeader(supabase, kind, id),
    fetchTodayStatus(supabase, { kind, id, userId: profile.id, today: todayAU() }),
  ])
  if (!header) notFound()

  const mapsUrl = header.siteLabel
    ? `https://maps.google.com/?q=${encodeURIComponent(header.siteLabel)}`
    : null

  return (
    <div className="flex flex-col gap-4">
      {(header.siteLabel || header.contactPhone) && (
        <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
          {header.siteLabel && (
            <div className="flex items-start gap-1.5">
              <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm">{header.siteLabel}</p>
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Navigate
                  </a>
                )}
              </div>
            </div>
          )}
          {header.contactPhone && (
            <a
              href={`tel:${header.contactPhone}`}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              <PhoneIcon className="size-3.5 shrink-0" />
              {header.contactPhone}
            </a>
          )}
        </div>
      )}

      {status.note && (
        <div className="rounded-xl border px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Note from the office
          </p>
          <p className="text-sm">{status.note}</p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Today on this job
        </h2>
        <div className="flex flex-col divide-y rounded-xl border">
          {todayRows(status).map((row) => {
            const Icon = ROW_ICONS[row.key]
            return (
              <Link
                key={row.key}
                href={workHref(kind, id, row.tab)}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors active:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  {row.label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs font-medium',
                      TONE_CLASS[row.tone]
                    )}
                  >
                    {row.chip}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
