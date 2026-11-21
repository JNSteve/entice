import { describe, expect, it } from 'vitest'
import {
  approveChip,
  attentionReasons,
  compareDayRows,
  dayBoundsAU,
  describeUsage,
  entryHours,
  fmtHours,
  hoursLabel,
  isIsoDate,
  isWorkKind,
  materialsEditable,
  shiftDate,
  summariseHours,
  timeOfDayAU,
  timesToInstants,
  usageLineSchema,
  usageRowFields,
  type AttentionReason,
  type HoursEntry,
} from '@/lib/site-days'

// Brisbane is UTC+10 all year: 20:42Z on the 19th = 06:42 on the 20th.
const sam: HoursEntry = { userId: 'u1', startAt: '2026-11-19T20:42:00Z', endAt: '2026-11-20T05:06:00Z', approved: true }
const jo: HoursEntry = { userId: 'u2', startAt: '2026-11-19T20:45:00Z', endAt: '2026-11-20T05:00:00Z', approved: false }
const ali: HoursEntry = { userId: 'u3', startAt: '2026-11-19T21:10:00Z', endAt: null, approved: false }

describe('dates', () => {
  it('recognises work kinds', () => {
    expect(isWorkKind('job')).toBe(true)
    expect(isWorkKind('project')).toBe(true)
    expect(isWorkKind('quote')).toBe(false)
  })

  it('accepts only real ISO dates', () => {
    expect(isIsoDate('2026-11-20')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('20-11-2026')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })

  it('shifts whole calendar days', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('bounds a Brisbane day in UTC', () => {
    expect(dayBoundsAU('2026-11-20')).toEqual({
      startIso: '2026-11-19T14:00:00.000Z',
      endIso: '2026-11-20T14:00:00.000Z',
    })
  })

  it('formats a Brisbane time of day', () => {
    expect(timeOfDayAU('2026-11-19T20:42:00Z')).toBe('06:42')
    expect(timeOfDayAU('2026-11-20T05:06:59Z')).toBe('15:06')
  })
})

describe('hours', () => {
  it('computes decimal hours, zero for open or negative', () => {
    expect(entryHours(sam.startAt, sam.endAt)).toBeCloseTo(8.4, 5)
    expect(entryHours(ali.startAt, null)).toBe(0)
    expect(entryHours('2026-11-20T05:00:00Z', '2026-11-20T04:00:00Z')).toBe(0)
  })

  it('formats hours to two decimals with a dash for none', () => {
    expect(fmtHours(8.4)).toBe('8.4')
    expect(fmtHours(8.333333)).toBe('8.33')
    expect(fmtHours(0)).toBe('—')
  })

  it('summarises a day', () => {
    const s = summariseHours([sam, jo, ali])
    expect(s.people).toBe(3)
    expect(s.closed).toBe(2)
    expect(s.approved).toBe(1)
    expect(s.open).toBe(1)
    expect(s.totalHours).toBeCloseTo(16.65, 5)
  })

  it('counts one person with two entries once', () => {
    const second: HoursEntry = { ...sam, startAt: '2026-11-20T05:30:00Z', endAt: '2026-11-20T06:30:00Z' }
    expect(summariseHours([sam, second]).people).toBe(1)
  })

  it('words the list column', () => {
    expect(hoursLabel(summariseHours([sam, jo, ali]))).toBe('Still checked in')
    expect(hoursLabel(summariseHours([sam, jo]))).toBe('1 of 2 approved')
    expect(hoursLabel(summariseHours([]))).toBe('No hours')
  })

  it('words the day-page chip', () => {
    expect(approveChip(summariseHours([sam, jo, ali]))).toEqual({ text: '2 of 3 hours to approve', done: false })
    expect(approveChip(summariseHours([sam]))).toEqual({ text: 'Hours approved', done: true })
    expect(approveChip(summariseHours([]))).toEqual({ text: 'No hours logged', done: true })
  })
})

describe('attention', () => {
  const hours = summariseHours([sam, jo, ali])

  it('flags an open check-in only on a past day', () => {
    expect(attentionReasons({ date: '2026-11-19', today: '2026-11-20', hours, prestartDone: true })).toContain('open_checkin')
    expect(attentionReasons({ date: '2026-11-20', today: '2026-11-20', hours, prestartDone: true })).not.toContain('open_checkin')
  })

  it('flags hours with no pre-start, and unapproved hours', () => {
    expect(attentionReasons({ date: '2026-11-20', today: '2026-11-20', hours, prestartDone: false })).toEqual(['no_prestart', 'unapproved'])
  })

  it('flags nothing for a day with no hours', () => {
    expect(attentionReasons({ date: '2026-11-19', today: '2026-11-20', hours: summariseHours([]), prestartDone: false })).toEqual([])
  })

  it('sorts attention first, then newest number', () => {
    const rows: { number: string; attention: AttentionReason[] }[] = [
      { number: 'J-26030', attention: [] },
      { number: 'J-26031', attention: [] },
      { number: 'J-26010', attention: ['unapproved'] },
    ]
    expect(rows.sort(compareDayRows).map((r) => r.number)).toEqual(['J-26010', 'J-26031', 'J-26030'])
  })
})

describe('materials lock', () => {
  it('is editable only while the day has no sign-off', () => {
    expect(materialsEditable(null)).toBe(true)
    expect(materialsEditable({ status: 'draft' })).toBe(false)
    expect(materialsEditable({ status: 'signed' })).toBe(false)
  })
})

describe('timesToInstants', () => {
  it('reads times as Brisbane wall-clock on the given day', () => {
    expect(timesToInstants('2026-11-20', '06:45', '15:00')).toEqual({
      startIso: '2026-11-19T20:45:00.000Z',
      endIso: '2026-11-20T05:00:00.000Z',
    })
  })

  it('allows an open finish', () => {
    expect(timesToInstants('2026-11-20', '06:45', null)).toEqual({
      startIso: '2026-11-19T20:45:00.000Z',
      endIso: null,
    })
  })

  it('rejects bad input', () => {
    expect(timesToInstants('2026-11-20', '15:00', '06:45')).toEqual({ error: 'Finish must be after start' })
    expect(timesToInstants('2026-11-20', '15:00', '15:00')).toEqual({ error: 'Finish must be after start' })
    expect(timesToInstants('2026-11-20', '', '15:00')).toEqual({ error: 'Enter a start time' })
    expect(timesToInstants('2026-11-20', '06:45', '24:00')).toEqual({ error: 'Enter a finish time' })
    expect(timesToInstants('2026-02-30', '06:45', '15:00')).toEqual({ error: 'Invalid date' })
  })
})

describe('usage lines', () => {
  it('requires a quantity for materials and plant', () => {
    const r = usageLineSchema.safeParse({ kind: 'material', description: 'Black plastic', qty: null })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Enter a quantity')
  })

  it('requires company, headcount and hours for a subbie', () => {
    const r = usageLineSchema.safeParse({ kind: 'subbie', company: '', headcount: 2, hours: 4 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Enter the company name')
  })

  it('normalises a material row', () => {
    const v = usageLineSchema.parse({ kind: 'material', description: ' Black plastic ', qty: 2, unit: 'rolls' })
    expect(usageRowFields(v)).toEqual({
      kind: 'material', description: 'Black plastic', qty: 2, unit: 'rolls',
      company: null, headcount: null, hours: null,
    })
  })

  it('defaults plant to hours and copies a subbie company into the description', () => {
    const plant = usageLineSchema.parse({ kind: 'plant', description: 'NPU 1,500 CFM', qty: 8 })
    expect(usageRowFields(plant).unit).toBe('hrs')
    const subbie = usageLineSchema.parse({ kind: 'subbie', company: 'Scaffold crew', headcount: 2, hours: 4 })
    expect(usageRowFields(subbie)).toEqual({
      kind: 'subbie', description: 'Scaffold crew', qty: null, unit: null,
      company: 'Scaffold crew', headcount: 2, hours: 4,
    })
  })

  it('describes a line for display', () => {
    expect(describeUsage({ kind: 'material', description: 'Black plastic', qty: 2, unit: 'rolls', company: null, headcount: null, hours: null }))
      .toEqual({ item: 'Black plastic', qty: '2 rolls' })
    expect(describeUsage({ kind: 'subbie', description: 'Scaffold crew', qty: null, unit: null, company: 'Scaffold crew', headcount: 2, hours: 4 }))
      .toEqual({ item: 'Scaffold crew', qty: '2 people · 4 h' })
    expect(describeUsage({ kind: 'subbie', description: 'Sparky', qty: null, unit: null, company: 'Sparky', headcount: 1, hours: 3 }).qty)
      .toBe('1 person · 3 h')
  })
})
