// Office "Site days" — pure rules shared by the day list, the day page and
// the server actions. No I/O here (see src/lib/site-days-queries.ts).
//
// Hours and quantities only: nothing in this module carries a rate or amount.

import { z } from 'zod'
import { auLocalToInstant } from '@/lib/tz'

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkKind = 'job' | 'project'

/** One job or project on one Brisbane calendar day. */
export type DayRef = { kind: WorkKind; workId: string; date: string }

export type CrewEntry = {
  id: string
  userId: string
  name: string
  startAt: string
  endAt: string | null
  approved: boolean
  /** True when the entry has no schedule link (assignment_id is null). */
  unscheduled: boolean
}

export type UsageLine = {
  id: string
  kind: 'material' | 'plant' | 'subbie'
  description: string
  qty: number | null
  unit: string | null
  company: string | null
  headcount: number | null
  hours: number | null
  loggedBy: string | null
}

export type HoursEntry = {
  userId: string
  startAt: string
  endAt: string | null
  approved: boolean
}

export type HoursSummary = {
  people: number
  totalHours: number
  closed: number
  approved: number
  open: number
}

export type AttentionReason = 'open_checkin' | 'no_prestart' | 'unapproved'

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  open_checkin: 'Still checked in',
  no_prestart: 'No pre-start',
  unapproved: 'Hours to approve',
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export function isWorkKind(v: string): v is WorkKind {
  return v === 'job' || v === 'project'
}

/** True for a real 'YYYY-MM-DD' calendar date. */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 'YYYY-MM-DD' shifted by whole days (pure calendar arithmetic). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** UTC instants bounding a Brisbane calendar day: [startIso, endIso). */
export function dayBoundsAU(date: string): { startIso: string; endIso: string } {
  const start = new Date(`${date}T00:00:00+10:00`)
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + 86_400_000).toISOString(),
  }
}

/** "06:42" (24 hour) in Brisbane for an ISO instant. */
export function timeOfDayAU(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Brisbane',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// ─── Hours ───────────────────────────────────────────────────────────────────

/** Decimal hours for a closed entry; 0 while still checked in. */
export function entryHours(startAt: string, endAt: string | null): number {
  if (!endAt) return 0
  return Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000)
}

export function fmtHours(n: number): string {
  return n > 0 ? String(Math.round(n * 100) / 100) : '—'
}

export function summariseHours(entries: readonly HoursEntry[]): HoursSummary {
  const people = new Set<string>()
  let totalHours = 0
  let closed = 0
  let approved = 0
  let open = 0
  for (const e of entries) {
    people.add(e.userId)
    if (e.endAt == null) {
      open++
      continue
    }
    closed++
    totalHours += entryHours(e.startAt, e.endAt)
    if (e.approved) approved++
  }
  return { people: people.size, totalHours, closed, approved, open }
}

/** Day-list column: "3 of 4 approved", "Still checked in" or "No hours". */
export function hoursLabel(s: HoursSummary): string {
  if (s.open > 0) return 'Still checked in'
  if (s.closed === 0) return 'No hours'
  return `${s.approved} of ${s.closed} approved`
}

/** Day-page header chip. */
export function approveChip(s: HoursSummary): { text: string; done: boolean } {
  const total = s.closed + s.open
  if (total === 0) return { text: 'No hours logged', done: true }
  const todo = total - s.approved
  if (todo === 0) return { text: 'Hours approved', done: true }
  return { text: `${todo} of ${total} hours to approve`, done: false }
}

// ─── Attention ───────────────────────────────────────────────────────────────

export function attentionReasons(f: {
  date: string
  today: string
  hours: HoursSummary
  prestartDone: boolean
}): AttentionReason[] {
  const out: AttentionReason[] = []
  if (f.hours.open > 0 && f.date < f.today) out.push('open_checkin')
  if (f.hours.closed + f.hours.open > 0 && !f.prestartDone) out.push('no_prestart')
  if (f.hours.closed > f.hours.approved) out.push('unapproved')
  return out
}

/** Rows needing attention first, then the newest work number. */
export function compareDayRows(
  a: { attention: AttentionReason[]; number: string },
  b: { attention: AttentionReason[]; number: string }
): number {
  if (a.attention.length !== b.attention.length) return b.attention.length - a.attention.length
  return b.number.localeCompare(a.number)
}

// ─── Materials lock ──────────────────────────────────────────────────────────

/**
 * The materials log is edited on the day page only while the day has no
 * sign-off at all. Once one exists (any status) the sign-off screen is the
 * single place to change the figures the client sees.
 */
export function materialsEditable(signoff: { status: string } | null): boolean {
  return signoff === null
}

// ─── Validation ──────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 'HH:MM' start and finish on a Brisbane day → UTC instants for storage.
 * A shift may not cross midnight: finish must be later the same day.
 */
export function timesToInstants(
  date: string,
  start: string,
  end: string | null
): { startIso: string; endIso: string | null } | { error: string } {
  if (!isIsoDate(date)) return { error: 'Invalid date' }
  if (!HHMM.test(start)) return { error: 'Enter a start time' }
  if (end !== null && !HHMM.test(end)) return { error: 'Enter a finish time' }
  if (end !== null && end <= start) return { error: 'Finish must be after start' }
  return {
    startIso: auLocalToInstant(`${date}T${start}`),
    endIso: end === null ? null : auLocalToInstant(`${date}T${end}`),
  }
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

/** Same rules as the crew's own form (src/app/field/usage/actions.ts). */
export const usageLineSchema = z
  .object({
    kind: z.enum(['material', 'plant', 'subbie']),
    description: z.string().trim().max(300).optional().default(''),
    qty: z.number().min(0, 'Quantity can’t be negative').optional().nullable(),
    unit: optText(20),
    company: optText(200),
    headcount: z.number().int().min(1).max(500).optional().nullable(),
    hours: z.number().min(0).max(24, 'Hours must be 24 or less').optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'subbie') {
      if (!v.company) ctx.addIssue({ code: 'custom', message: 'Enter the company name' })
      if (v.headcount == null) ctx.addIssue({ code: 'custom', message: 'Enter how many people' })
      if (v.hours == null) ctx.addIssue({ code: 'custom', message: 'Enter the hours' })
    } else {
      if (!v.description) ctx.addIssue({ code: 'custom', message: 'Enter what was used' })
      if (v.qty == null || Number.isNaN(v.qty)) {
        ctx.addIssue({
          code: 'custom',
          message: v.kind === 'plant' ? 'Enter the hours' : 'Enter a quantity',
        })
      }
    }
  })

export type UsageLineInput = z.infer<typeof usageLineSchema>

/**
 * Column values normalised so field_usage's check constraints hold. Leaves
 * the crew's quote-line / price-list / plant-register links untouched.
 */
export function usageRowFields(v: UsageLineInput): {
  kind: UsageLine['kind']
  description: string
  qty: number | null
  unit: string | null
  company: string | null
  headcount: number | null
  hours: number | null
} {
  if (v.kind === 'subbie') {
    return {
      kind: v.kind,
      description: v.company!,
      qty: null,
      unit: null,
      company: v.company,
      headcount: v.headcount ?? null,
      hours: v.hours ?? null,
    }
  }
  return {
    kind: v.kind,
    description: v.description,
    qty: v.qty ?? null,
    unit: v.kind === 'plant' ? (v.unit ?? 'hrs') : v.unit,
    company: null,
    headcount: null,
    hours: null,
  }
}

export function describeUsage(
  u: Pick<UsageLine, 'kind' | 'description' | 'qty' | 'unit' | 'company' | 'headcount' | 'hours'>
): { item: string; qty: string } {
  if (u.kind === 'subbie') {
    const people = u.headcount ?? 0
    return {
      item: u.company ?? u.description,
      qty: `${people} ${people === 1 ? 'person' : 'people'} · ${u.hours ?? 0} h`,
    }
  }
  return { item: u.description, qty: `${u.qty ?? 0} ${u.unit ?? ''}`.trim() }
}
