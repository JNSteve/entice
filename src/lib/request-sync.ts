// Auto-sync of portal work requests from downstream work — PURE gating logic
// (no Supabase imports; vitest-safe). The SQL definer fn
// sync_portal_requests_for_quote (supabase/migrations/0034_request_sync.sql)
// enforces the same rules server-side — change them together.
//
// Events fired by the office actions:
//   work_scheduled — the request's linked quote converted to a job/project
//                    (convertQuoteToJob/convertQuoteToProject)
//   work_completed — that work reached its client-facing done state
//                    (job → completed via setJobStatus; project → closed via
//                    updateProject — matching workGroupForJob/Project)
//
// Rules: forward-only along REQUEST_TRANSITIONS, manual override always wins
// (a manually advanced/declined request is skipped, never regressed), and the
// caller wires it fire-and-forget (next/server after()) so it can never block
// or fail the parent action.

import {
  canTransitionRequest,
  REQUEST_STATUSES,
  type RequestStatus,
} from '@/lib/portal-interactions'

export type WorkSyncEvent = 'work_scheduled' | 'work_completed'

/** The request status each downstream event drives towards. */
export const WORK_SYNC_TARGET: Record<WorkSyncEvent, RequestStatus> = {
  work_scheduled: 'scheduled',
  work_completed: 'completed',
}

/**
 * The status the request should auto-advance to for `event`, or null when the
 * move is not legal from `currentStatus` (already ahead, terminal, declined,
 * or unknown). Mirrors the WHERE clause in sync_portal_requests_for_quote.
 */
export function autoSyncTarget(
  currentStatus: string,
  event: WorkSyncEvent
): RequestStatus | null {
  const target = WORK_SYNC_TARGET[event]
  if (!target) return null
  return canTransitionRequest(currentStatus, target) ? target : null
}

/** Statuses a given event may move a request FROM (documents the SQL sets). */
export function autoSyncEligibleStatuses(event: WorkSyncEvent): RequestStatus[] {
  return REQUEST_STATUSES.filter(
    (status) => autoSyncTarget(status, event) !== null
  )
}
