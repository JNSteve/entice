import { describe, expect, it } from 'vitest'
import {
  buildSnapshotLines,
  roundQuarter,
  validateDisputes,
  type TimesheetSource,
  type UsageSource,
} from '@/lib/signoffs'
import { sourceHash } from '@/lib/signoff-hash'

// Brisbane is UTC+10 all year: 21:00Z = 07:00 next day local.
function entry(over: Partial<TimesheetSource> & { id: string }): TimesheetSource {
  return {
    user_id: 'u1',
    full_name: 'Sam Crew',
    start_at: '2026-09-30T21:00:00Z', // 07:00 1 Oct
    end_at: '2026-10-01T05:30:00Z', // 15:30 1 Oct
    approved: true,
    ...over,
  }
}

function usage(over: Partial<UsageSource> & { id: string; kind: UsageSource['kind'] }): UsageSource {
  return {
    description: 'Item',
    qty: 1,
    unit: null,
    company: null,
    headcount: null,
    hours: null,
    scope_label: null,
    updated_at: '2026-10-01T06:00:00Z',
    ...over,
  }
}

describe('roundQuarter', () => {
  it('rounds to the nearest quarter hour', () => {
    expect(roundQuarter(8.5)).toBe(8.5)
    expect(roundQuarter(8.12)).toBe(8)
    expect(roundQuarter(8.13)).toBe(8.25)
    expect(roundQuarter(7.9)).toBe(8)
  })
})

describe('buildSnapshotLines — labour', () => {
  it('groups entries per person, sums hours and shows Brisbane time ranges', () => {
    const lines = buildSnapshotLines({
      timesheets: [
        entry({ id: 't1', start_at: '2026-09-30T21:00:00Z', end_at: '2026-10-01T02:00:00Z' }), // 07:00–12:00
        entry({ id: 't2', start_at: '2026-10-01T02:30:00Z', end_at: '2026-10-01T05:30:00Z' }), // 12:30–15:30
        entry({ id: 't3', user_id: 'u2', full_name: 'Alex Able' }),
      ],
      usage: [],
    })
    expect(lines).toHaveLength(2)
    // Sorted by name
    expect(lines[0]).toMatchObject({
      section: 'labour',
      description: 'Alex Able',
      qty: 8.5,
      unit: 'hrs',
      detail: '07:00–15:30',
      flags: [],
      source: { timesheet_entry_ids: ['t3'] },
    })
    expect(lines[1]).toMatchObject({
      description: 'Sam Crew',
      qty: 8,
      detail: '07:00–12:00, 12:30–15:30',
      source: { timesheet_entry_ids: ['t1', 't2'] },
    })
  })

  it('flags someone still checked in and counts only closed time', () => {
    const [line] = buildSnapshotLines({
      timesheets: [entry({ id: 't1', end_at: null })],
      usage: [],
    })
    expect(line.qty).toBe(0)
    expect(line.flags).toContain('still_checked_in')
    expect(line.detail).toBe('07:00–(still on site)')
  })

  it('flags unapproved time and long shifts', () => {
    const [line] = buildSnapshotLines({
      timesheets: [
        entry({
          id: 't1',
          approved: false,
          start_at: '2026-09-30T20:00:00Z',
          end_at: '2026-10-01T09:00:00Z', // 13h
        }),
      ],
      usage: [],
    })
    expect(line.qty).toBe(13)
    expect(line.flags).toEqual(['unapproved', 'long_shift'])
  })
})

describe('buildSnapshotLines — usage', () => {
  it('orders sections labour → subbie → plant → material and keeps input order within', () => {
    const lines = buildSnapshotLines({
      timesheets: [entry({ id: 't1' })],
      usage: [
        usage({ id: 'm1', kind: 'material', description: 'Poly sheet', qty: 3, unit: 'roll', scope_label: 'Enclosure' }),
        usage({ id: 'p1', kind: 'plant', description: 'Excavator 5t', qty: 6 }),
        usage({ id: 's1', kind: 'subbie', description: 'ABC Scaffolding', company: 'ABC Scaffolding', headcount: 2, hours: 8, qty: null }),
        usage({ id: 'm2', kind: 'material', description: 'Bags', qty: 40, unit: null }),
      ],
    })
    expect(lines.map((l) => l.section)).toEqual(['labour', 'subbie', 'plant', 'material', 'material'])
    expect(lines.map((l) => l.sort)).toEqual([0, 10, 20, 30, 40])
    expect(lines[1]).toMatchObject({
      description: 'ABC Scaffolding',
      qty: 16,
      unit: 'man-hrs',
      detail: '2 people × 8 h',
      source: { field_usage_id: 's1' },
    })
    expect(lines[2]).toMatchObject({ description: 'Excavator 5t', qty: 6, unit: 'hrs' })
    expect(lines[3]).toMatchObject({ description: 'Poly sheet', qty: 3, unit: 'roll', scope_label: 'Enclosure' })
    expect(lines[4]).toMatchObject({ description: 'Bags', qty: 40, unit: 'ea' })
  })

  it('says "1 person" for a single subbie', () => {
    const [line] = buildSnapshotLines({
      timesheets: [],
      usage: [usage({ id: 's1', kind: 'subbie', description: 'Sparky', company: 'Sparky', headcount: 1, hours: 4, qty: null })],
    })
    expect(line.detail).toBe('1 person × 4 h')
    expect(line.qty).toBe(4)
  })
})

describe('sourceHash', () => {
  const timesheets = [entry({ id: 't1' }), entry({ id: 't2', user_id: 'u2' })]
  const items = [usage({ id: 'm1', kind: 'material' })]

  it('is stable regardless of row order', () => {
    expect(sourceHash({ timesheets, usage: items })).toBe(
      sourceHash({ timesheets: [...timesheets].reverse(), usage: items })
    )
    expect(sourceHash({ timesheets, usage: items })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when a source row changes', () => {
    const before = sourceHash({ timesheets, usage: items })
    const edited = [entry({ id: 't1', end_at: '2026-10-01T06:00:00Z' }), timesheets[1]]
    expect(sourceHash({ timesheets: edited, usage: items })).not.toBe(before)
    expect(
      sourceHash({ timesheets, usage: [usage({ id: 'm1', kind: 'material', updated_at: '2026-10-02T00:00:00Z' })] })
    ).not.toBe(before)
  })
})

describe('validateDisputes', () => {
  const ids = new Set(['a', 'b'])

  it('accepts an empty list and trims reasons', () => {
    expect(validateDisputes([], ids)).toEqual({ ok: true, disputes: [] })
    expect(validateDisputes([{ line_id: 'a', client_qty: 6, reason: '  left at 1pm ' }], ids)).toEqual({
      ok: true,
      disputes: [{ line_id: 'a', client_qty: 6, reason: 'left at 1pm' }],
    })
  })

  it('rejects unknown, duplicate, negative, non-numeric and unexplained disputes', () => {
    expect(validateDisputes([{ line_id: 'z', client_qty: 1, reason: 'x' }], ids)).toHaveProperty('error')
    expect(
      validateDisputes(
        [
          { line_id: 'a', client_qty: 1, reason: 'x' },
          { line_id: 'a', client_qty: 2, reason: 'y' },
        ],
        ids
      )
    ).toHaveProperty('error')
    expect(validateDisputes([{ line_id: 'a', client_qty: -1, reason: 'x' }], ids)).toHaveProperty('error')
    expect(validateDisputes([{ line_id: 'a', client_qty: Number.NaN, reason: 'x' }], ids)).toHaveProperty('error')
    expect(validateDisputes([{ line_id: 'a', client_qty: 1, reason: '   ' }], ids)).toHaveProperty('error')
    expect(validateDisputes([{ line_id: 'a', client_qty: 1, reason: 'x'.repeat(501) }], ids)).toHaveProperty('error')
    expect(validateDisputes('nope', ids)).toHaveProperty('error')
  })
})
