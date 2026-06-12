'use client'

import { useState } from 'react'
import { Gantt } from './gantt'
import { HoldPointDialog, HoldPointsRegister } from './hold-points'
import type { HoldPoint, ProgrammeLink, ProgrammeTask } from './types'

/**
 * Client shell for the programme tab: the Gantt (bars, dependency arrows,
 * baseline ghosts, hold point diamonds) plus the hold point register below.
 * Owns the hold point dialog so diamonds, register rows and the task dialog
 * can all open it.
 */
export function ProgrammeView({
  projectId,
  tasks,
  links,
  holdPoints,
  projectStartDate,
  canDelete,
  canSetBaseline,
  isAdmin,
}: {
  projectId: string
  tasks: ProgrammeTask[]
  links: ProgrammeLink[]
  holdPoints: HoldPoint[]
  projectStartDate: string | null
  canDelete: boolean
  canSetBaseline: boolean
  isAdmin: boolean
}) {
  const [hpDialog, setHpDialog] = useState<{
    holdPoint: HoldPoint | null
    defaultTaskId?: string
  } | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <Gantt
        projectId={projectId}
        tasks={tasks}
        links={links}
        holdPoints={holdPoints}
        projectStartDate={projectStartDate}
        canDelete={canDelete}
        canSetBaseline={canSetBaseline}
        onHoldPointClick={(hp) => setHpDialog({ holdPoint: hp })}
        onAddHoldPoint={(task) =>
          setHpDialog({ holdPoint: null, defaultTaskId: task.id })
        }
      />

      <HoldPointsRegister
        projectId={projectId}
        tasks={tasks}
        holdPoints={holdPoints}
        isAdmin={isAdmin}
        canDelete={canDelete}
        onEdit={(hp) => setHpDialog({ holdPoint: hp })}
        onAdd={() => setHpDialog({ holdPoint: null })}
      />

      {hpDialog && (
        <HoldPointDialog
          key={hpDialog.holdPoint?.id ?? hpDialog.defaultTaskId ?? 'new'}
          projectId={projectId}
          tasks={tasks}
          holdPoint={hpDialog.holdPoint}
          defaultTaskId={hpDialog.defaultTaskId}
          onClose={() => setHpDialog(null)}
        />
      )}
    </div>
  )
}
