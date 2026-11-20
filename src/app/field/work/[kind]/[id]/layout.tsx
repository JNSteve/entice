import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { WORK_STATUS_LABELS, parseWorkKind } from '@/lib/live-work'
import { fetchWorkHeader } from '@/lib/field-work-queries'
import { WorkTabs } from './work-tabs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function WorkLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind || !UUID_RE.test(id)) notFound()

  const supabase = await createClient()
  const header = await fetchWorkHeader(supabase, kind, id)
  if (!header) notFound()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Link
            href="/field/jobs"
            aria-label="Back to jobs"
            className="mt-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{header.number}</span> ·{' '}
              {WORK_STATUS_LABELS[header.status] ?? header.status}
            </p>
            <h1 className="truncate text-lg font-bold leading-tight">{header.title}</h1>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          render={<Link href="/field/jobs" />}
        >
          Switch job
        </Button>
      </div>

      <WorkTabs kind={kind} id={id} />

      {children}
    </div>
  )
}
