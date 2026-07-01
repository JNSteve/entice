'use client'

import Link from 'next/link'
import { FileDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { aud, fmtDate } from '@/lib/format'
import { round2 } from '@/lib/money'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

export type WipProjectRow = {
  id: string
  number: string
  name: string
  /** Σ total_inc_gst across submitted/certified/paid claims (billed inc GST). */
  claimed: number
  /** Σ certified_amount of certified + paid claims (certified inc GST). */
  certified: number
  /** Σ certified_amount of paid claims (inc GST). */
  paid: number
  /** claimed − certified — billed value not yet certified (inc GST). */
  exposure: number
}

export type WipJobRow = {
  id: string
  number: string
  title: string
  client: string
  quoted: number
  completedAt: string | null
  daysSinceCompleted: number | null
}

export function WipReport({
  projects,
  jobs,
}: {
  projects: WipProjectRow[]
  jobs: WipJobRow[]
}) {
  const totals = {
    claimed: round2(projects.reduce((s, r) => s + r.claimed, 0)),
    certified: round2(projects.reduce((s, r) => s + r.certified, 0)),
    paid: round2(projects.reduce((s, r) => s + r.paid, 0)),
    exposure: round2(projects.reduce((s, r) => s + r.exposure, 0)),
  }

  function exportProjects() {
    downloadCsv(
      `wip-projects-${format(new Date(), 'yyyyMMdd')}.csv`,
      projects.map((r) => ({
        Project: r.number,
        Name: r.name,
        'Claimed inc GST': r.claimed,
        'Certified inc GST': r.certified,
        'Paid inc GST': r.paid,
        'Uncertified exposure': r.exposure,
      }))
    )
  }

  function exportJobs() {
    downloadCsv(
      `wip-uninvoiced-jobs-${format(new Date(), 'yyyyMMdd')}.csv`,
      jobs.map((r) => ({
        Job: r.number,
        Title: r.title,
        Client: r.client,
        'Quoted value': r.quoted,
        Completed: r.completedAt ? fmtDate(r.completedAt) : '',
        'Days since completed': r.daysSinceCompleted ?? '',
      }))
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Projects */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Project claims</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={exportProjects}
            disabled={projects.length === 0}
          >
            <FileDownIcon className="size-4" />
            Export CSV
          </Button>
        </div>

        {projects.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No open projects.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Claimed (inc GST)</TableHead>
                  <TableHead className="text-right">Certified (inc GST)</TableHead>
                  <TableHead className="text-right">Paid (inc GST)</TableHead>
                  <TableHead className="text-right">Uncertified exposure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${r.id}/claims`}
                        className="font-medium hover:underline"
                      >
                        <span className="font-mono text-xs">{r.number}</span>{' '}
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.claimed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.certified)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.paid)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums font-medium',
                        r.exposure > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {aud(r.exposure)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted font-medium">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(totals.claimed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(totals.certified)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(totals.paid)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(totals.exposure)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Completed, uninvoiced jobs */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Completed jobs not yet invoiced</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={exportJobs}
            disabled={jobs.length === 0}
          >
            <FileDownIcon className="size-4" />
            Export CSV
          </Button>
        </div>

        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No completed jobs awaiting an invoice.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Quoted value</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="text-right">Days since completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/jobs/${r.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {r.number}
                      </Link>
                    </TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>{r.client}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {aud(r.quoted)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.completedAt ? fmtDate(r.completedAt) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        (r.daysSinceCompleted ?? 0) > 14
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {r.daysSinceCompleted ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
