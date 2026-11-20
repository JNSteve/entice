'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { BriefcaseIcon, MapPinIcon, PhoneIcon, LogInIcon, LogOutIcon, ChevronDownIcon, ChevronUpIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { checkIn, checkOut, createManualEntry } from './actions'
import { useElapsed } from './use-elapsed'
import { workHref } from '@/lib/live-work'

// ─── Types ───────────────────────────────────────────────────────────────────

export type AssignmentCard = {
  id: string
  target_type: 'job' | 'project'
  number: string
  title: string
  site_name: string | null
  site_address: string | null
  note: string | null
  contact_phone: string | null
  job_id: string | null
  project_id: string | null
  date: string
}

export type OpenEntry = {
  id: string
  assignment_id: string | null
  start_at: string
  job_number: string | null
  job_title: string | null
  project_number: string | null
  project_name: string | null
}

export type TomorrowItem = {
  number: string
  title: string
}

export type WeekSummary = {
  hours: number
  entries: number
}

export type WorkOption = {
  key: string
  label: string
  job_id: string | null
  project_id: string | null
}

interface Props {
  assignments: AssignmentCard[]
  openEntry: OpenEntry | null
  tomorrow: TomorrowItem[]
  weekSummary: WeekSummary
  today: string // YYYY-MM-DD
  workOptions: WorkOption[]
}

// ─── Checked-in banner ──────────────────────────────────────────────────────

function CheckedInBanner({ entry }: { entry: OpenEntry }) {
  const [pending, startTransition] = useTransition()
  const elapsed = useElapsed(entry.start_at)

  const target = entry.job_number
    ? `${entry.job_number} — ${entry.job_title ?? ''}`
    : entry.project_number
      ? `${entry.project_number} — ${entry.project_name ?? ''}`
      : 'Unknown'

  const startTime = new Date(entry.start_at).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
  })

  function handleCheckOut() {
    startTransition(async () => {
      const result = await checkOut()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Checked out successfully')
      }
    })
  }

  return (
    <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-sm font-semibold text-green-700 dark:text-green-400">
          Checked in at {startTime}
        </p>
        <p className="text-xs text-muted-foreground truncate">{target}</p>
        <p className="text-xs font-mono text-muted-foreground tabular-nums">{elapsed}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-green-500/40 text-green-700 hover:bg-green-500/10 dark:text-green-400"
        onClick={handleCheckOut}
        disabled={pending}
      >
        <LogOutIcon className="size-3.5 mr-1" />
        {pending ? 'Checking out…' : 'Check out'}
      </Button>
    </div>
  )
}

// ─── Assignment card ─────────────────────────────────────────────────────────

function AssignmentCardItem({
  assignment,
  hasOpenEntry,
  isCheckedIntoThis,
}: {
  assignment: AssignmentCard
  hasOpenEntry: boolean
  isCheckedIntoThis: boolean
}) {
  const [pending, startTransition] = useTransition()

  const fullAddress = [
    assignment.site_address,
    assignment.site_name,
  ]
    .filter(Boolean)
    .join(', ')

  const mapsUrl = fullAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`
    : null

  function handleCheckIn() {
    startTransition(async () => {
      const result = await checkIn({
        job_id: assignment.job_id,
        project_id: assignment.project_id,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Checked in successfully')
      }
    })
  }

  const chipLabel = assignment.target_type === 'job' ? 'Job' : 'Project'

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="shrink-0 text-xs">
              {chipLabel}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {assignment.number}
            </span>
            <span className="text-sm font-medium truncate">{assignment.title}</span>
          </div>
        </div>

        {(assignment.site_name || assignment.site_address) && (
          <div className="flex items-start gap-1.5">
            <MapPinIcon className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {fullAddress}
              </p>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Navigate
                </a>
              )}
            </div>
          </div>
        )}

        {assignment.note && (
          <p className="text-xs text-muted-foreground italic">{assignment.note}</p>
        )}

        {assignment.contact_phone && (
          <a
            href={`tel:${assignment.contact_phone}`}
            className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            <PhoneIcon className="size-3.5 shrink-0" />
            {assignment.contact_phone}
          </a>
        )}

        <div className="pt-1">
          {isCheckedIntoThis ? (
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">
              Currently checked in here
            </p>
          ) : hasOpenEntry ? (
            <Button size="sm" variant="outline" disabled className="w-full text-xs">
              Check out first
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full"
              onClick={handleCheckIn}
              disabled={pending}
            >
              <LogInIcon className="size-3.5 mr-1" />
              {pending ? 'Checking in…' : 'Check in'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full text-xs"
            render={
              <Link
                href={workHref(
                  assignment.target_type,
                  (assignment.job_id ?? assignment.project_id) as string
                )}
              />
            }
          >
            Open job
            <ChevronRightIcon className="size-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Manual entry form ───────────────────────────────────────────────────────

function ManualEntrySection({
  options,
  today,
}: {
  options: WorkOption[]
  today: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [workKey, setWorkKey] = useState(options[0]?.key ?? '')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const w = options.find((x) => x.key === workKey)
    if (!w) return

    startTransition(async () => {
      const result = await createManualEntry({
        job_id: w.job_id,
        project_id: w.project_id,
        date: today,
        start_time: startTime,
        end_time: endTime,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Manual entry added')
        setStartTime('')
        setEndTime('')
        setOpen(false)
      }
    })
  }

  if (options.length === 0) return null

  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
      >
        Add manual time
        {open ? (
          <ChevronUpIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 border-t px-4 py-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium">Job</label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
              value={workKey}
              onChange={(e) => setWorkKey(e.target.value)}
              required
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">Start time</label>
              <input
                type="time"
                className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">End time</label>
              <input
                type="time"
                className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save entry'}
          </Button>
        </form>
      )}
    </div>
  )
}

// ─── Main client component ───────────────────────────────────────────────────

export function MyDayClient({
  assignments,
  openEntry,
  tomorrow,
  weekSummary,
  today,
  workOptions,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      {/* Checked-in banner */}
      {openEntry && <CheckedInBanner entry={openEntry} />}

      {/* Assignment cards */}
      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div>
            <p className="text-sm font-medium">Nothing scheduled for you today</p>
            <p className="text-sm text-muted-foreground">
              Pick the job you&apos;re on and check in there.
            </p>
          </div>
          <Button render={<Link href="/field/jobs" />}>
            <BriefcaseIcon className="size-4 mr-1" />
            Pick a job
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {assignments.map((a) => (
            <AssignmentCardItem
              key={a.id}
              assignment={a}
              hasOpenEntry={openEntry !== null}
              isCheckedIntoThis={openEntry?.assignment_id === a.id}
            />
          ))}
          <Link
            href="/field/jobs"
            className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium">Somewhere else today?</span>
              <span className="text-xs text-muted-foreground">
                Open any live job or project, scheduled or not.
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      )}

      {/* Manual entry — any live job */}
      <ManualEntrySection options={workOptions} today={today} />

      {/* Tomorrow preview */}
      {tomorrow.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Tomorrow
          </p>
          {tomorrow.map((t) => (
            <p key={t.number} className="text-sm text-muted-foreground">
              {t.number} — {t.title}
            </p>
          ))}
        </div>
      )}

      {/* This week summary */}
      {(weekSummary.entries > 0 || weekSummary.hours > 0) && (
        <div className="rounded-xl border px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">This week</p>
          <p className="text-sm font-medium tabular-nums">
            {weekSummary.hours.toFixed(1)}h across {weekSummary.entries}{' '}
            {weekSummary.entries === 1 ? 'entry' : 'entries'}
          </p>
        </div>
      )}
    </div>
  )
}
