'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArchiveIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'
import { setQuoteArchived } from '@/app/(office)/quotes/actions'
import { setJobArchived } from '@/app/(office)/jobs/actions'
import { setProjectArchived } from '@/app/(office)/projects/actions'

export interface ArchivedRecordRow {
  id: string
  number: string
  title: string
  client_name: string | null
  archived_at: string | null
}

type ArchiveKind = 'quote' | 'job' | 'project'

const CONFIG: Record<
  ArchiveKind,
  { heading: string; href: (id: string) => string; restore: (id: string) => Promise<{ error?: string }> }
> = {
  quote: {
    heading: 'Quotes',
    href: (id) => `/quotes/${id}`,
    restore: (id) => setQuoteArchived(id, false),
  },
  job: {
    heading: 'Jobs',
    href: (id) => `/jobs/${id}`,
    restore: (id) => setJobArchived(id, false),
  },
  project: {
    heading: 'Projects',
    href: (id) => `/projects/${id}`,
    restore: (id) => setProjectArchived(id, false),
  },
}

export function ArchiveSection({
  quotes,
  jobs,
  projects,
}: {
  quotes: ArchivedRecordRow[]
  jobs: ArchivedRecordRow[]
  projects: ArchivedRecordRow[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Archived records are hidden from lists, pickers and reports. Nothing is
        deleted — restore any record to bring it back.
      </p>
      <ArchiveSubsection kind="quote" rows={quotes} />
      <ArchiveSubsection kind="job" rows={jobs} />
      <ArchiveSubsection kind="project" rows={projects} />
    </div>
  )
}

function ArchiveSubsection({
  kind,
  rows,
}: {
  kind: ArchiveKind
  rows: ArchivedRecordRow[]
}) {
  const config = CONFIG[kind]

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{config.heading}</h3>
      {rows.length === 0 ? (
        <EmptyState
          icon={<ArchiveIcon className="size-8" />}
          title="Nothing archived."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">
                    <Link
                      href={config.href(row.id)}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{row.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.client_name ?? '—'}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.archived_at ? fmtDate(row.archived_at) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <RestoreButton
                        onRestore={() => config.restore(row.id)}
                        label={row.number}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function RestoreButton({
  onRestore,
  label,
}: {
  onRestore: () => Promise<{ error?: string }>
  label: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await onRestore()
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${label} restored`)
      router.refresh()
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? 'Restoring…' : 'Restore'}
    </Button>
  )
}
