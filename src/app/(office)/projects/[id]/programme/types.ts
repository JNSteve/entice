export type ProgrammeTask = {
  id: string
  name: string
  phase: string | null
  start_date: string // YYYY-MM-DD
  end_date: string // YYYY-MM-DD
  progress_pct: number
  position: number
  baseline_start: string | null // YYYY-MM-DD
  baseline_end: string | null // YYYY-MM-DD
}

export type ProgrammeLink = {
  id: string
  predecessor_id: string
  successor_id: string
}

export type HoldPointStatus = 'pending' | 'notified' | 'released'

export type HoldPoint = {
  id: string
  task_id: string
  title: string
  required_by: string
  date: string // YYYY-MM-DD
  status: HoldPointStatus
  notified_at: string | null
  released_at: string | null
  released_by: string | null
  release_ref: string | null
  notes: string | null
}

/** Diamond marker colours shared by the Gantt and the register. */
export const HOLD_POINT_COLOUR: Record<HoldPointStatus, string> = {
  pending: 'bg-red-500',
  notified: 'bg-amber-500',
  released: 'bg-green-500',
}
