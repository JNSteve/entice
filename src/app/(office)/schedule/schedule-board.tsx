'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { StickyNoteIcon, TriangleAlertIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AssignDialog } from './assign-dialog'
import type { AssignmentRecord, SchedulableJob, SchedulableProject } from './assign-dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProfileRow = {
  id: string
  full_name: string
  role: string
}

export type AssignmentWithTarget = AssignmentRecord & {
  jobs: { number: string; title: string } | null
  projects: { number: string; name: string } | null
}

interface ScheduleBoardProps {
  /** Mon–Sun as 'YYYY-MM-DD' strings */
  weekDays: string[]
  profiles: ProfileRow[]
  assignments: AssignmentWithTarget[]
  jobs: SchedulableJob[]
  projects: SchedulableProject[]
  todayStr: string
}

// ─── Role ordering ────────────────────────────────────────────────────────────

const ROLE_ORDER = ['supervisor', 'field', 'office', 'admin'] as const
const ROLE_LABELS: Record<string, string> = {
  supervisor: 'Supervisor',
  field: 'Field',
  office: 'Office',
  admin: 'Admin',
}

function roleIndex(role: string): number {
  const idx = (ROLE_ORDER as readonly string[]).indexOf(role)
  return idx === -1 ? 99 : idx
}

// ─── Assignment chip ──────────────────────────────────────────────────────────

function AssignmentChip({
  assignment,
  hasConflict,
  onClick,
}: {
  assignment: AssignmentWithTarget
  hasConflict: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const isProject = assignment.project_id !== null
  const target = isProject ? assignment.projects : assignment.jobs
  const number = target?.number ?? '—'
  const name = isProject
    ? (assignment.projects?.name ?? '')
    : (assignment.jobs?.title ?? '')

  return (
    <button
      type="button"
      onClick={onClick}
      title={assignment.note ?? undefined}
      className={cn(
        'flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs text-left transition-colors',
        isProject
          ? 'bg-blue-100 hover:bg-blue-200 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100 dark:hover:bg-blue-900/50'
          : 'bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50'
      )}
    >
      {hasConflict && (
        <TriangleAlertIcon
          className="size-3 shrink-0 text-destructive"
          aria-label="Double-booked"
        />
      )}
      <span className="font-medium shrink-0">{number}</span>
      <span className="truncate min-w-0 text-[10px] opacity-70">{name}</span>
      {assignment.note && (
        <StickyNoteIcon className="ml-auto size-3 shrink-0 opacity-60" />
      )}
    </button>
  )
}

// ─── ScheduleBoard ────────────────────────────────────────────────────────────

export function ScheduleBoard({
  weekDays,
  profiles,
  assignments,
  jobs,
  projects,
  todayStr,
}: ScheduleBoardProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const [dialogDate, setDialogDate] = useState(weekDays[0] ?? '')
  const [dialogUserId, setDialogUserId] = useState('')
  const [editAssignment, setEditAssignment] = useState<AssignmentWithTarget | undefined>()

  // Index assignments by "userId::date"
  const byUserDate = new Map<string, AssignmentWithTarget[]>()
  for (const a of assignments) {
    const key = `${a.user_id}::${a.date}`
    const list = byUserDate.get(key) ?? []
    list.push(a)
    byUserDate.set(key, list)
  }

  // Sort profiles: supervisors → field → office → admin, then alpha
  const sortedProfiles = [...profiles].sort((a, b) => {
    const ri = roleIndex(a.role) - roleIndex(b.role)
    return ri !== 0 ? ri : a.full_name.localeCompare(b.full_name)
  })

  function openCreate(userId: string, date: string) {
    setDialogUserId(userId)
    setDialogDate(date)
    setEditAssignment(undefined)
    setDialogKey((k) => k + 1)
    setDialogOpen(true)
  }

  function openEdit(a: AssignmentWithTarget) {
    setDialogUserId(a.user_id)
    setDialogDate(a.date)
    setEditAssignment(a)
    setDialogKey((k) => k + 1)
    setDialogOpen(true)
  }

  return (
    <>
      {/* Horizontally scrollable grid wrapper for small screens */}
      <div className="overflow-x-auto rounded-lg border">
        <div style={{ minWidth: '700px' }}>
          {/* Header row */}
          <div
            className="grid bg-muted/40 text-xs font-medium text-muted-foreground border-b"
            style={{ gridTemplateColumns: '160px repeat(7, 1fr)' }}
          >
            <div className="px-3 py-2">Person</div>
            {weekDays.map((d) => (
              <div
                key={d}
                className={cn(
                  'px-1 py-2 text-center border-l',
                  d === todayStr && 'bg-primary/10 text-primary font-semibold'
                )}
              >
                <div>{format(new Date(d + 'T00:00:00'), 'EEE')}</div>
                <div className="text-[10px] opacity-70">
                  {format(new Date(d + 'T00:00:00'), 'd MMM')}
                </div>
              </div>
            ))}
          </div>

          {/* Profile rows */}
          {sortedProfiles.map((profile) => (
            <div
              key={profile.id}
              className="grid border-b last:border-b-0 hover:bg-muted/5"
              style={{ gridTemplateColumns: '160px repeat(7, 1fr)' }}
            >
              {/* Name + role badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 text-sm border-r">
                <span className="font-medium truncate flex-1">{profile.full_name}</span>
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] capitalize px-1 h-4"
                >
                  {ROLE_LABELS[profile.role] ?? profile.role}
                </Badge>
              </div>

              {/* Day cells */}
              {weekDays.map((d) => {
                const key = `${profile.id}::${d}`
                const cellAssignments = byUserDate.get(key) ?? []
                const hasConflict = cellAssignments.length > 1

                return (
                  <div
                    key={d}
                    onClick={() => {
                      if (cellAssignments.length === 0) openCreate(profile.id, d)
                    }}
                    className={cn(
                      'flex flex-col gap-0.5 p-1 border-l min-h-[44px] transition-colors',
                      cellAssignments.length === 0 &&
                        'cursor-pointer hover:bg-muted/30',
                      d === todayStr && 'bg-primary/5'
                    )}
                  >
                    {cellAssignments.map((a) => (
                      <AssignmentChip
                        key={a.id}
                        assignment={a}
                        hasConflict={hasConflict}
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(a)
                        }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}

          {sortedProfiles.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No active staff profiles.
            </div>
          )}
        </div>
      </div>

      {/* Shared dialog for create + edit */}
      <AssignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dialogKey={String(dialogKey)}
        userId={dialogUserId}
        defaultDate={dialogDate}
        assignment={editAssignment}
        jobs={jobs}
        projects={projects}
      />
    </>
  )
}
