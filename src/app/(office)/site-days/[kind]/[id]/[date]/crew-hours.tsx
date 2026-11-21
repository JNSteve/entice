'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { entryHours, fmtHours, timeOfDayAU, type CrewEntry, type DayRef } from '@/lib/site-days'
import {
  addTimesheetEntry,
  deleteTimesheetEntry,
  setEntryApproved,
  updateEntryTimes,
} from '@/app/(office)/site-days/actions'

type Result = { error?: string }

export function CrewHours({
  dayRef,
  rows,
  people,
}: {
  dayRef: DayRef
  rows: CrewEntry[]
  people: { id: string; name: string }[]
}) {
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [adding, setAdding] = useState(false)
  const [newUser, setNewUser] = useState(people[0]?.id ?? '')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')

  function run(action: () => Promise<Result>, done?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
        return
      }
      done?.()
    })
  }

  function openEditor(row: CrewEntry) {
    setEditingId(row.id)
    setStart(timeOfDayAU(row.startAt))
    setEnd(row.endAt ? timeOfDayAU(row.endAt) : '')
  }

  function saveEdit(row: CrewEntry) {
    run(
      () => updateEntryTimes(dayRef, row.id, start, end === '' ? null : end),
      () => setEditingId(null)
    )
  }

  function remove(row: CrewEntry) {
    if (!confirm(`Delete this entry for ${row.name}?`)) return
    run(() => deleteTimesheetEntry(dayRef, row.id))
  }

  function add() {
    run(
      () => addTimesheetEntry(dayRef, newUser, newStart, newEnd),
      () => {
        setAdding(false)
        setNewStart('')
        setNewEnd('')
      }
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Crew and hours</h2>
        <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)} disabled={pending}>
          <PlusIcon />
          Add entry
        </Button>
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Person
            <select
              aria-label="Person"
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Start
            <Input
              type="time"
              aria-label="New start time"
              className="w-28"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Finish
            <Input
              type="time"
              aria-label="New finish time"
              className="w-28"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </label>
          <Button size="sm" onClick={add} disabled={pending}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody checked in on this job on this day.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Finish</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead />
                <TableHead>Approved</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const editing = editingId === row.id
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {editing ? (
                        <Input
                          type="time"
                          aria-label="Start time"
                          className="w-28"
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                        />
                      ) : (
                        timeOfDayAU(row.startAt)
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {editing ? (
                        <Input
                          type="time"
                          aria-label="Finish time"
                          className="w-28"
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                        />
                      ) : row.endAt ? (
                        timeOfDayAU(row.endAt)
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        >
                          Still checked in
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(entryHours(row.startAt, row.endAt))}
                    </TableCell>
                    <TableCell>
                      {row.unscheduled && <Badge variant="outline">Unscheduled</Badge>}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={row.approved}
                        disabled={pending || row.endAt == null}
                        onCheckedChange={(checked) =>
                          run(() => setEntryApproved(dayRef, row.id, checked === true))
                        }
                        aria-label={`Approve hours for ${row.name}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {editing ? (
                        <span className="inline-flex gap-1">
                          <Button size="sm" onClick={() => saveEdit(row)} disabled={pending}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            disabled={pending}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          {row.endAt == null && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditor(row)}
                              disabled={pending}
                            >
                              Set finish
                            </Button>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openEditor(row)}
                            disabled={pending}
                            aria-label={`Edit hours for ${row.name}`}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => remove(row)}
                            disabled={pending}
                            aria-label={`Delete entry for ${row.name}`}
                          >
                            <Trash2Icon />
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Changing the times on an approved entry clears its tick, so changed hours are approved again.
      </p>
    </section>
  )
}
