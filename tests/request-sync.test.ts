import { describe, expect, it } from 'vitest'
import {
  autoSyncEligibleStatuses,
  autoSyncTarget,
  WORK_SYNC_TARGET,
} from '@/lib/request-sync'
import { REQUEST_TRANSITIONS } from '@/lib/portal-interactions'

// These gates mirror the WHERE clause in sync_portal_requests_for_quote
// (supabase/migrations/0034_request_sync.sql) — change them together.

describe('work → request auto-sync gating', () => {
  it('maps events to their target statuses', () => {
    expect(WORK_SYNC_TARGET.work_scheduled).toBe('scheduled')
    expect(WORK_SYNC_TARGET.work_completed).toBe('completed')
  })

  it('quote conversion schedules a request still in triage or quoted', () => {
    expect(autoSyncTarget('submitted', 'work_scheduled')).toBe('scheduled')
    expect(autoSyncTarget('reviewed', 'work_scheduled')).toBe('scheduled')
    expect(autoSyncTarget('quoted', 'work_scheduled')).toBe('scheduled')
  })

  it('work completion completes a quoted or scheduled request', () => {
    expect(autoSyncTarget('quoted', 'work_completed')).toBe('completed')
    expect(autoSyncTarget('scheduled', 'work_completed')).toBe('completed')
  })

  it('never regresses a manually advanced request', () => {
    // Already scheduled (manually or by an earlier sync) — a second
    // conversion event must not touch it.
    expect(autoSyncTarget('scheduled', 'work_scheduled')).toBeNull()
    // Already completed — nothing moves it.
    expect(autoSyncTarget('completed', 'work_scheduled')).toBeNull()
    expect(autoSyncTarget('completed', 'work_completed')).toBeNull()
  })

  it('manual decline always beats auto-sync', () => {
    expect(autoSyncTarget('declined', 'work_scheduled')).toBeNull()
    expect(autoSyncTarget('declined', 'work_completed')).toBeNull()
  })

  it('completion cannot skip forward from raw triage states', () => {
    // submitted/reviewed → completed is not a legal REQUEST_TRANSITIONS move;
    // a request whose quote converted is at least 'quoted' anyway.
    expect(autoSyncTarget('submitted', 'work_completed')).toBeNull()
    expect(autoSyncTarget('reviewed', 'work_completed')).toBeNull()
  })

  it('ignores unknown statuses defensively', () => {
    expect(autoSyncTarget('junk', 'work_scheduled')).toBeNull()
    expect(autoSyncTarget('', 'work_completed')).toBeNull()
  })

  it('eligible-status sets match the SQL WHERE clause exactly', () => {
    expect(autoSyncEligibleStatuses('work_scheduled')).toEqual([
      'submitted',
      'reviewed',
      'quoted',
    ])
    expect(autoSyncEligibleStatuses('work_completed')).toEqual([
      'quoted',
      'scheduled',
    ])
  })

  it('stays consistent with REQUEST_TRANSITIONS as the single source', () => {
    for (const [from, targets] of Object.entries(REQUEST_TRANSITIONS)) {
      expect(autoSyncTarget(from, 'work_scheduled') !== null).toBe(
        targets.includes('scheduled')
      )
      expect(autoSyncTarget(from, 'work_completed') !== null).toBe(
        targets.includes('completed')
      )
    }
  })
})
