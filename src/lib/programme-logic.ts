import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'

/**
 * Pure programme-dependency logic (no IO) shared by the Gantt client and the
 * programme server actions: cycle detection for finish-to-start links and the
 * forward auto-shift cascade applied after a task moves.
 */

export type ProgrammeLinkEdge = {
  predecessor_id: string
  successor_id: string
}

export type ProgrammeTaskDates = {
  id: string
  start_date: string // YYYY-MM-DD
  end_date: string // YYYY-MM-DD
}

export type ProgrammeShift = {
  id: string
  newStart: string
  newEnd: string
}

function iso(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** predecessor → successors adjacency map. */
function adjacency(links: ProgrammeLinkEdge[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of links) {
    const list = out.get(l.predecessor_id)
    if (list) list.push(l.successor_id)
    else out.set(l.predecessor_id, [l.successor_id])
  }
  return out
}

/**
 * True when the dependency graph formed by `links` (+ optional `newLink`)
 * contains a cycle — including transitive ones (A→B→C→A) and self-links.
 * Iterative DFS with white/grey/black colouring.
 */
export function detectCycle(
  links: ProgrammeLinkEdge[],
  newLink?: ProgrammeLinkEdge
): boolean {
  const all = newLink ? [...links, newLink] : links
  if (all.some((l) => l.predecessor_id === l.successor_id)) return true

  const adj = adjacency(all)
  const state = new Map<string, 1 | 2>() // 1 = in progress, 2 = done

  for (const start of adj.keys()) {
    if (state.get(start) === 2) continue
    // Stack of [node, nextChildIndex]
    const stack: [string, number][] = [[start, 0]]
    state.set(start, 1)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const children = adj.get(frame[0]) ?? []
      if (frame[1] >= children.length) {
        state.set(frame[0], 2)
        stack.pop()
        continue
      }
      const child = children[frame[1]++]
      const s = state.get(child)
      if (s === 1) return true // back edge → cycle
      if (s === undefined) {
        state.set(child, 1)
        stack.push([child, 0])
      }
    }
  }
  return false
}

/**
 * All tasks reachable from `taskId` by following predecessor → successor
 * links (transitive successors). Used to exclude cycle-creating candidates
 * from the predecessor picker: X may not become a predecessor of T when T
 * already leads to X.
 */
export function getDescendants(
  links: ProgrammeLinkEdge[],
  taskId: string
): Set<string> {
  const adj = adjacency(links)
  const seen = new Set<string>()
  const queue = [taskId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const next of adj.get(id) ?? []) {
      if (next === taskId || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

/**
 * Finish-to-start auto-shift: after `changedTaskId` moves, walk its successors
 * breadth-first. Any successor that now starts on or before its predecessor's
 * end is pushed forward (duration preserved) so it starts the day after, and
 * the shift cascades through the graph. Returns only the tasks that moved.
 *
 * Guards against malformed (cyclic) graphs with a per-node visit cap, so it
 * can never loop forever even if a cycle slipped into the data.
 */
export function computeAutoShifts(
  tasks: ProgrammeTaskDates[],
  links: ProgrammeLinkEdge[],
  changedTaskId: string
): ProgrammeShift[] {
  const adj = adjacency(links)
  const dates = new Map(
    tasks.map((t) => [t.id, { start: t.start_date, end: t.end_date }])
  )
  if (!dates.has(changedTaskId)) return []

  const shifted = new Map<string, ProgrammeShift>()
  const visits = new Map<string, number>()
  const maxVisits = links.length + 1
  const queue = [changedTaskId]

  while (queue.length > 0) {
    const predId = queue.shift()!
    const seen = (visits.get(predId) ?? 0) + 1
    visits.set(predId, seen)
    if (seen > maxVisits) continue // cycle guard

    const pred = dates.get(predId)
    if (!pred) continue

    for (const succId of adj.get(predId) ?? []) {
      const succ = dates.get(succId)
      if (!succ) continue
      if (succ.start > pred.end) continue // no violation — stop this branch

      const duration = differenceInCalendarDays(
        parseISO(succ.end),
        parseISO(succ.start)
      )
      const newStart = addDays(parseISO(pred.end), 1)
      const next = { start: iso(newStart), end: iso(addDays(newStart, duration)) }
      dates.set(succId, next)
      shifted.set(succId, { id: succId, newStart: next.start, newEnd: next.end })
      queue.push(succId)
    }
  }

  return [...shifted.values()]
}
