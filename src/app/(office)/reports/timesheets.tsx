'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import {
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileDownIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { round2 } from '@/lib/money'
import { downloadCsv } from '@/lib/csv'
import { approveTimesheetEntry, approveTimesheetWeek } from './actions'

export type TimesheetEntryRow = {
  id: string
  date: string
  /** "J-xxx Title" / "P-xxx Name" / '—'. */
  target: string
  startAt: string
  endAt: string | null
  /** Decimal hours; 0 for open entries. */
  hours: number
  /** True when the entry was not started from an assignment. */
  manual: boolean
  approved: boolean
}

export type PersonWeekRow = {
  userId: string
  name: string
  /** Σ closed-entry hours keyed by yyyy-MM-dd. */
  dailyHours: Record<string, number>
  total: number
  entries: TimesheetEntryRow[]
}

function fmtHours(n: number): string {
  return n > 0 ? String(round2(n)) : '—'
}

export function TimesheetsReport({
  weekDays,
  weekLabel,
  prevWeek,
  nextWeek,
  isCurrentWeek,
  people,
}: {
  /** Monday → Sunday as yyyy-MM-dd. */
  weekDays: string[]
  weekLabel: string
  prevWeek: string
  nextWeek: string
  isCurrentWeek: boolean
  people: PersonWeekRow[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function handleApproveEntry(entryId: string, approved: boolean) {
    startTransition(async () => {
      const result = await approveTimesheetEntry(entryId, approved)
      if (result.error) toast.error(result.error)
    })
  }

  function handleApproveWeek(person: PersonWeekRow) {
    startTransition(async () => {
      const result = await approveTimesheetWeek(person.userId, weekDays[0])
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Week approved for ${person.name}`)
    })
  }

  function handleExport() {
    downloadCsv(
      `timesheets-${weekDays[0]}.csv`,
      people.flatMap((p) =>
        p.entries.map((e) => ({
          Person: p.name,
          Date: e.date,
          Target: e.target,
          Start: format(parseISO(e.startAt), 'HH:mm'),
          End: e.endAt ? format(parseISO(e.endAt), 'HH:mm') : '',
          Hours: e.hours > 0 ? round2(e.hours) : '',
          Approved: e.approved ? 'Yes' : 'No',
        }))
      )
    )
  }

  const reportHref = (week: string) => `/reports?report=timesheets&week=${week}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Week picker */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href={reportHref(prevWeek)} />}
          >
            <ChevronLeftIcon className="size-4" />
            <span className="sr-only">Previous week</span>
          </Button>
          <Button
            variant={isCurrentWeek ? 'default' : 'outline'}
            size="sm"
            render={<Link href="/reports?report=timesheets" />}
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={reportHref(nextWeek)} />}
          >
            <ChevronRightIcon className="size-4" />
            <span className="sr-only">Next week</span>
          </Button>
          <span className="ml-1 text-sm text-muted-foreground">{weekLabel}</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={people.length === 0}
        >
          <FileDownIcon className="size-4" />
          Export CSV
        </Button>
      </div>

      {people.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No timesheet entries this week.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Person</TableHead>
                {weekDays.map((d) => (
                  <TableHead key={d} className="text-right">
                    {format(parseISO(d), 'EEE d')}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const isOpen = expanded.has(p.userId)
                const closedEntries = p.entries.filter((e) => e.endAt != null)
                const allApproved =
                  closedEntries.length > 0 && closedEntries.every((e) => e.approved)
                return (
                  <React.Fragment key={p.userId}>
                    <TableRow>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => toggle(p.userId)}
                          aria-label={isOpen ? 'Collapse entries' : 'Expand entries'}
                        >
                          {isOpen ? (
                            <ChevronDownIcon className="size-4" />
                          ) : (
                            <ChevronRightIcon className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      {weekDays.map((d) => (
                        <TableCell key={d} className="text-right tabular-nums">
                          {fmtHours(p.dailyHours[d] ?? 0)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">
                        {fmtHours(p.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending || closedEntries.length === 0 || allApproved}
                          onClick={() => handleApproveWeek(p)}
                        >
                          <CheckCheckIcon className="size-4" />
                          {allApproved ? 'Approved' : 'Approve week'}
                        </Button>
                      </TableCell>
                    </TableRow>

                    {isOpen &&
                      (p.entries.length === 0 ? (
                        <TableRow className="bg-muted/40">
                          <TableCell />
                          <TableCell
                            colSpan={weekDays.length + 3}
                            className="text-xs text-muted-foreground"
                          >
                            No entries.
                          </TableCell>
                        </TableRow>
                      ) : (
                        p.entries.map((e) => (
                          <TableRow key={e.id} className="bg-muted/40">
                            <TableCell />
                            <TableCell
                              colSpan={weekDays.length}
                              className="pl-8 text-xs"
                            >
                              <span className="tabular-nums text-muted-foreground">
                                {format(parseISO(e.date), 'EEE d MMM')}
                              </span>{' '}
                              <span className="font-medium">{e.target}</span>{' '}
                              <span className="tabular-nums text-muted-foreground">
                                {format(parseISO(e.startAt), 'HH:mm')}–
                                {e.endAt ? format(parseISO(e.endAt), 'HH:mm') : 'open'}
                              </span>
                              {e.manual && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-[10px]"
                                >
                                  Manual
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {fmtHours(e.hours)}
                            </TableCell>
                            <TableCell className="text-right">
                              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Checkbox
                                  checked={e.approved}
                                  disabled={pending || e.endAt == null}
                                  onCheckedChange={(checked) =>
                                    handleApproveEntry(e.id, checked === true)
                                  }
                                  aria-label={`Approve entry on ${e.date}`}
                                />
                                Approved
                              </label>
                            </TableCell>
                          </TableRow>
                        ))
                      ))}
                  </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
