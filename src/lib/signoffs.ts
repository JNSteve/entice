// Daily field sign-offs — pure logic shared by the snapshot builder, the
// office review page, the portal and the PDF. No I/O here (see
// src/lib/signoff-build.ts for loading/writing).
//
// Quantities only: nothing in this module ever carries a rate or amount.

export type SignoffSection = 'labour' | 'subbie' | 'plant' | 'material'
export type SignoffStatus = 'draft' | 'released' | 'signed' | 'disputed' | 'superseded'

export const SIGNOFF_SECTIONS: SignoffSection[] = ['labour', 'subbie', 'plant', 'material']

export const SIGNOFF_SECTION_LABELS: Record<SignoffSection, string> = {
  labour: 'Labour',
  subbie: 'Subcontractors',
  plant: 'Plant & equipment',
  material: 'Materials',
}

export const SIGNOFF_STATUS_LABELS: Record<SignoffStatus, string> = {
  draft: 'Draft — not released',
  released: 'Awaiting client',
  signed: 'Signed',
  disputed: 'Disputed',
  superseded: 'Replaced by a revision',
}

export const FLAG_LABELS: Record<string, string> = {
  still_checked_in: 'Still checked in — fix the check-out before release',
  unapproved: 'Timesheet not yet approved',
  long_shift: 'Over 12 hours',
  client_figure: "Set to the client's figure",
}

export const LONG_SHIFT_HOURS = 12

export type TimesheetSource = {
  id: string
  user_id: string
  full_name: string
  start_at: string
  end_at: string | null
  approved: boolean
}

export type UsageSource = {
  id: string
  kind: 'material' | 'plant' | 'subbie'
  description: string
  qty: number | null
  unit: string | null
  company: string | null
  headcount: number | null
  hours: number | null
  scope_label: string | null
  updated_at: string
}

export type SnapshotLine = {
  sort: number
  section: SignoffSection
  description: string
  qty: number
  unit: string
  detail: string | null
  scope_label: string | null
  flags: string[]
  source: Record<string, unknown>
}

export function roundQuarter(hours: number): number {
  return Math.round(hours * 4) / 4
}

/** "07:00" in Brisbane for an ISO instant. */
function timeAU(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Brisbane',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function labourLines(timesheets: TimesheetSource[]): Omit<SnapshotLine, 'sort'>[] {
  const byUser = new Map<string, TimesheetSource[]>()
  for (const t of timesheets) {
    const list = byUser.get(t.user_id) ?? []
    list.push(t)
    byUser.set(t.user_id, list)
  }

  const lines: Omit<SnapshotLine, 'sort'>[] = []
  for (const entries of byUser.values()) {
    const sorted = [...entries].sort((a, b) => a.start_at.localeCompare(b.start_at))
    let ms = 0
    const ranges: string[] = []
    const flags: string[] = []
    for (const e of sorted) {
      if (e.end_at) {
        ms += Math.max(0, new Date(e.end_at).getTime() - new Date(e.start_at).getTime())
        ranges.push(`${timeAU(e.start_at)}–${timeAU(e.end_at)}`)
      } else {
        ranges.push(`${timeAU(e.start_at)}–(still on site)`)
        if (!flags.includes('still_checked_in')) flags.push('still_checked_in')
      }
    }
    const hours = roundQuarter(ms / 3_600_000)
    if (sorted.some((e) => !e.approved)) flags.push('unapproved')
    if (hours > LONG_SHIFT_HOURS) flags.push('long_shift')

    lines.push({
      section: 'labour',
      description: sorted[0].full_name,
      qty: hours,
      unit: 'hrs',
      detail: ranges.join(', '),
      scope_label: null,
      flags,
      source: { timesheet_entry_ids: sorted.map((e) => e.id) },
    })
  }
  return lines.sort((a, b) => a.description.localeCompare(b.description))
}

function usageLine(u: UsageSource): Omit<SnapshotLine, 'sort'> {
  const source = { field_usage_id: u.id }
  if (u.kind === 'subbie') {
    const headcount = u.headcount ?? 1
    const hours = u.hours ?? 0
    return {
      section: 'subbie',
      description: (u.company ?? u.description).trim() || u.description,
      qty: Math.round(headcount * hours * 1000) / 1000,
      unit: 'man-hrs',
      detail: `${headcount} ${headcount === 1 ? 'person' : 'people'} × ${fmtNumber(hours)} h`,
      scope_label: u.scope_label,
      flags: [],
      source,
    }
  }
  return {
    section: u.kind,
    description: u.description,
    qty: u.qty ?? 0,
    unit: u.unit?.trim() || (u.kind === 'plant' ? 'hrs' : 'ea'),
    detail: null,
    scope_label: u.scope_label,
    flags: [],
    source,
  }
}

/**
 * The day's sheet: labour (one line per person) then subbies, plant and
 * materials in the order crew logged them.
 */
export function buildSnapshotLines(input: {
  timesheets: TimesheetSource[]
  usage: UsageSource[]
}): SnapshotLine[] {
  const usageLines = input.usage.map(usageLine)
  const ordered = [
    ...labourLines(input.timesheets),
    ...SIGNOFF_SECTIONS.filter((s) => s !== 'labour').flatMap((section) =>
      usageLines.filter((l) => l.section === section)
    ),
  ]
  return ordered.map((l, i) => ({ ...l, sort: i * 10 }))
}

export type DisputeInput = { line_id: string; client_qty: number; reason: string }

export const MAX_DISPUTE_REASON = 500

/** Client-side mirror of portal_signoff_respond's dispute checks. */
export function validateDisputes(
  raw: unknown,
  lineIds: ReadonlySet<string>
): { ok: true; disputes: DisputeInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Invalid disputes' }
  const seen = new Set<string>()
  const disputes: DisputeInput[] = []
  for (const item of raw) {
    const d = (item ?? {}) as Partial<DisputeInput>
    const lineId = typeof d.line_id === 'string' ? d.line_id : ''
    if (!lineIds.has(lineId)) return { error: 'A disputed line is not on this sheet' }
    if (seen.has(lineId)) return { error: 'A line is disputed twice' }
    seen.add(lineId)
    const qty = d.client_qty
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
      return { error: 'Enter your figure for each disputed line (0 or more)' }
    }
    const reason = typeof d.reason === 'string' ? d.reason.trim() : ''
    if (!reason) return { error: 'Give a reason for each disputed line' }
    if (reason.length > MAX_DISPUTE_REASON) {
      return { error: `Keep each reason under ${MAX_DISPUTE_REASON} characters` }
    }
    disputes.push({ line_id: lineId, client_qty: qty, reason })
  }
  return { ok: true, disputes }
}

export function fmtQty(qty: number): string {
  return fmtNumber(qty)
}
