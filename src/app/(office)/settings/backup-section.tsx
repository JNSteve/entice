'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { exportAllData } from './backup-actions'

/**
 * Data & Backup tab: one-click full JSON export of every business table,
 * read under the signed-in admin's own session. Pairs with the Records
 * Retention & Backup Policy (docs/iso/records-retention-backup-policy.md) —
 * run monthly and store the file off-platform.
 */
export function BackupSection() {
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
        <CardTitle>Data &amp; Backup</CardTitle>
        <CardDescription>
          Download a full JSON export of all business data — clients, quotes,
          jobs, projects, financials, WHS records, documents and the audit log.
          Attached files and signature images stay in Supabase storage and are
          covered by Supabase&apos;s own backups.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button onClick={handleExport} disabled={pending}>
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
