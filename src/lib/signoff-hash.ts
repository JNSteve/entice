// Server-only (node:crypto) — kept out of src/lib/signoffs.ts so client
// components can import the labels/types from there.
import { createHash } from 'node:crypto'
import type { TimesheetSource, UsageSource } from '@/lib/signoffs'

/**
 * Fingerprint of the source rows a snapshot was built from — compared later
 * to flag "source changed since snapshot" (informational only).
 */
export function sourceHash(input: { timesheets: TimesheetSource[]; usage: UsageSource[] }): string {
  const canonical = {
    t: input.timesheets
      // approved is deliberately excluded: approving time later changes no
      // quantity, so it must not flag every sent sheet as "source changed".
      .map((t) => [t.id, t.start_at, t.end_at] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
    u: input.usage
      .map((u) => [u.id, u.updated_at] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
