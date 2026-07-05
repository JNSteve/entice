'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { RETENTION_DAYS } from '@/lib/backup'
import { DatabaseBackupIcon } from 'lucide-react'
import { exportAllData } from './backup-actions'

export interface BackupRunRow {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failed'
  tables_count: number | null
  rows_total: number | null
  storage_objects_count: number | null
  storage_bytes_mirrored: number | null
  export_bytes: number | null
  path: string | null
  error: string | null
  trigger: 'cron' | 'manual'
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtDuration(run: BackupRunRow): string {
  if (!run.finished_at) return '—'
  const ms = parseISO(run.finished_at).getTime() - parseISO(run.started_at).getTime()
  if (ms < 0) return '—'
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}m`
}

function StatusBadge({ run }: { run: BackupRunRow }) {
  if (run.status === 'success') {
    return (
      <Badge className="bg-green-600/10 text-green-700 dark:text-green-400" variant="secondary">
        Success
      </Badge>
    )
  }
  if (run.status === 'failed') {
    return (
      <Badge variant="destructive" title={run.error ?? undefined}>
        Failed
      </Badge>
    )
  }
  return <Badge variant="secondary">Running</Badge>
}

/**
 * Data & Backup tab (admin-only page):
 *   1. Daily automatic backups — backup_runs register + "Run backup now".
 *   2. The original one-click manual JSON download (kept — it is the
 *      off-platform copy step in the Records Retention & Backup Policy).
 */
export function BackupSection({ runs }: { runs: BackupRunRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <DailyBackupsCard runs={runs} />
      <ManualExportCard />
    </div>
  )
}

function DailyBackupsCard({ runs }: { runs: BackupRunRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function runNow() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/cron/backup', { method: 'POST' })
        const body = (await res.json().catch(() => null)) as {
          error?: string
          rows_total?: number
          tables_count?: number
        } | null
        if (!res.ok) {
          toast.error(body?.error ?? `Backup failed (HTTP ${res.status})`)
        } else {
          toast.success(
            `Backup complete — ${body?.rows_total?.toLocaleString() ?? '?'} rows across ${body?.tables_count ?? '?'} tables`
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Backup request failed')
      }
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily backups</CardTitle>
        <CardDescription>
          Every table is exported automatically each night (3:00 am Brisbane)
          to a private storage bucket, together with an incremental mirror of
          uploaded files. {`Exports are kept for ${RETENTION_DAYS} days. `}Supabase
          Pro&apos;s own daily backups (7-day restore window) remain the first
          restore path — this is the independent second copy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button onClick={runNow} disabled={pending}>
            {pending ? 'Backing up…' : 'Run backup now'}
          </Button>
        </div>
        <DataTable
          columns={[
            {
              key: 'started_at',
              header: 'When',
              render: (r: BackupRunRow) => (
                <span className="tabular-nums">
                  {format(parseISO(r.started_at), 'dd/MM/yy HH:mm')}
                </span>
              ),
            },
            {
              key: 'trigger',
              header: 'Trigger',
              render: (r: BackupRunRow) => (
                <span className="capitalize text-muted-foreground">{r.trigger}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (r: BackupRunRow) => <StatusBadge run={r} />,
            },
            {
              key: 'tables',
              header: 'Tables',
              className: 'text-right',
              render: (r: BackupRunRow) => (
                <span className="block text-right tabular-nums">
                  {r.tables_count ?? '—'}
                </span>
              ),
            },
            {
              key: 'rows',
              header: 'Rows',
              className: 'text-right',
              render: (r: BackupRunRow) => (
                <span className="block text-right tabular-nums">
                  {r.rows_total?.toLocaleString() ?? '—'}
                </span>
              ),
            },
            {
              key: 'export',
              header: 'Export',
              className: 'text-right',
              render: (r: BackupRunRow) => (
                <span className="block text-right tabular-nums">
                  {fmtBytes(r.export_bytes)}
                </span>
              ),
            },
            {
              key: 'mirrored',
              header: 'Files mirrored',
              className: 'text-right',
              render: (r: BackupRunRow) => (
                <span className="block text-right tabular-nums">
                  {fmtBytes(r.storage_bytes_mirrored)}
                </span>
              ),
            },
            {
              key: 'duration',
              header: 'Duration',
              className: 'text-right',
              render: (r: BackupRunRow) => (
                <span className="block text-right tabular-nums">{fmtDuration(r)}</span>
              ),
            },
          ]}
          rows={runs}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<DatabaseBackupIcon className="size-8" />}
              title="No backups yet"
              description="The nightly job records its runs here. Run one now to check the pipeline."
            />
          }
        />
        <p className="text-xs text-muted-foreground">
          The dashboard raises a &ldquo;Needs attention&rdquo; alert when no
          successful backup has run in the last 26 hours.
        </p>
      </CardContent>
    </Card>
  )
}

function ManualExportCard() {
  const [pending, startTransition] = useTransition()
  const [lastExported, setLastExported] = useState<string | null>(null)

  function handleExport() {
    startTransition(async () => {
      const res = await exportAllData()
      if (res.error || !res.json) {
        toast.error(res.error ?? 'Export failed')
        return
      }

      // Same Blob-download pattern as the CSV exports (src/lib/csv.ts)
      const blob = new Blob([res.json], {
        type: 'application/json;charset=utf-8;',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Brisbane',
      })
        .format(new Date())
        .replace(/-/g, '')
      a.href = url
      a.download = `entice-backup-${stamp}.json`
      a.click()
      URL.revokeObjectURL(url)

      let summary = ''
      try {
        const parsed = JSON.parse(res.json) as {
          row_counts?: Record<string, number>
        }
        const counts = Object.values(parsed.row_counts ?? {})
        const total = counts.reduce((sum, n) => sum + n, 0)
        summary = ` — ${total.toLocaleString()} rows across ${counts.length} tables`
      } catch {
        // Summary is cosmetic; the file already downloaded.
      }

      setLastExported(new Date().toLocaleString())
      toast.success(`Backup downloaded${summary}`)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Off-platform export</CardTitle>
        <CardDescription>
          Download a full JSON export of all business data — clients, quotes,
          jobs, projects, financials, WHS records, documents and the audit
          log. Store it outside the platform (company drive / encrypted
          external drive) per the Records Retention &amp; Backup Policy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button variant="outline" onClick={handleExport} disabled={pending}>
            {pending ? 'Exporting…' : 'Export all data'}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {lastExported
            ? `Last exported ${lastExported} (this session).`
            : 'Run this monthly and keep the file somewhere outside the platform (e.g. the company drive), per the Records Retention & Backup Policy.'}
        </p>
      </CardContent>
    </Card>
  )
}
