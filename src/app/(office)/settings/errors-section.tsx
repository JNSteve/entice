'use client'

import { useTransition } from 'react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { BugIcon, CheckIcon } from 'lucide-react'
import { resolveAppError } from './actions'

export interface AppErrorRow {
  id: string
  at: string
  source: 'server' | 'client'
  path: string | null
  message: string
  stack: string | null
  user_role: string | null
  resolved: boolean
}

/**
 * Errors tab (admin-only page): the in-app error register. Server errors are
 * captured by instrumentation.ts onRequestError; client errors by the branded
 * error boundaries. Unresolved errors from the last 7 days raise a dashboard
 * "Needs attention" row.
 */
export function ErrorsSection({ errors }: { errors: AppErrorRow[] }) {
  const [pending, startTransition] = useTransition()

  function markResolved(id: string) {
    startTransition(async () => {
      const res = await resolveAppError(id)
      if (res.error) toast.error(res.error)
      else toast.success('Marked resolved')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application errors</CardTitle>
        <CardDescription>
          Captured automatically — server errors via the instrumentation hook,
          client errors via the branded error pages. Mark an error resolved
          once it has been investigated; unresolved errors from the last 7
          days appear on the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={[
            {
              key: 'at',
              header: 'When',
              render: (r: AppErrorRow) => (
                <span className="whitespace-nowrap tabular-nums">
                  {format(parseISO(r.at), 'dd/MM/yy HH:mm')}
                </span>
              ),
            },
            {
              key: 'source',
              header: 'Source',
              render: (r: AppErrorRow) => (
                <Badge variant="secondary" className="capitalize">
                  {r.source}
                </Badge>
              ),
            },
            {
              key: 'path',
              header: 'Path',
              render: (r: AppErrorRow) => (
                <span className="block max-w-40 truncate font-mono text-xs text-muted-foreground">
                  {r.path || '—'}
                </span>
              ),
            },
            {
              key: 'message',
              header: 'Message',
              render: (r: AppErrorRow) => (
                <span
                  className="block max-w-md truncate"
                  title={r.stack ? `${r.message}\n\n${r.stack}` : r.message}
                >
                  {r.message}
                </span>
              ),
            },
            {
              key: 'user_role',
              header: 'Role',
              render: (r: AppErrorRow) => (
                <span className="text-muted-foreground">{r.user_role ?? '—'}</span>
              ),
            },
            {
              key: 'resolved',
              header: 'Status',
              render: (r: AppErrorRow) =>
                r.resolved ? (
                  <Badge variant="secondary">Resolved</Badge>
                ) : (
                  <Badge variant="destructive">Open</Badge>
                ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              className: 'w-0',
              render: (r: AppErrorRow) =>
                r.resolved ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => markResolved(r.id)}
                  >
                    <CheckIcon />
                    Mark resolved
                  </Button>
                ),
            },
          ]}
          rows={errors}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<BugIcon className="size-8" />}
              title="No errors captured"
              description="Server and client errors will land here automatically."
            />
          }
        />
      </CardContent>
    </Card>
  )
}
