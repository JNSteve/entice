import { describe, expect, it } from 'vitest'
import {
  fmtDateAU,
  fmtDateTimeAU,
  fmtDuration,
  fmtTimeAU,
  hoursBetween,
  todayRows,
  type TodayStatus,
} from '@/lib/field-today'

const base: TodayStatus = {
  prestartSubmittedAt: null,
  swmsTotal: 0,
  swmsToSign: 0,
  usageCount: 0,
  diarySaved: null,
  photoCount: 0,
}

const chip = (s: TodayStatus, key: string) => todayRows(s).find((r) => r.key === key)

describe('fmtTimeAU', () => {
  it('shows Brisbane wall-clock time for a UTC instant', () => {
    // 20:50 UTC on the 19th is 6:50 am on the 20th in Brisbane (+10, no DST).
    expect(fmtTimeAU('2026-11-19T20:50:00Z')).toBe('6:50 am')
    expect(fmtTimeAU('2026-11-20T05:05:00Z')).toBe('3:05 pm')
  })
})

describe('fmtDateAU', () => {
  it('gives the Brisbane date, not the UTC date, for an early-morning instant', () => {
    // 6:50 am Friday 20 Nov in Brisbane is still Thursday 19 Nov in UTC.
    expect(fmtDateAU('2026-11-19T20:50:00Z')).toBe('20/11/2026')
  })

  it('agrees with UTC once Brisbane is past 10 am', () => {
    expect(fmtDateAU('2026-11-20T05:05:00Z')).toBe('20/11/2026')
  })

  it('accepts the +00:00 form Postgres returns', () => {
    expect(fmtDateAU('2026-01-01T13:59:59.123456+00:00')).toBe('01/01/2026')
    expect(fmtDateAU('2026-01-01T14:00:00+00:00')).toBe('02/01/2026')
  })
})

describe('fmtDateTimeAU', () => {
  it('shows the Brisbane date and 24-hour time for a stored instant', () => {
    // 02:03 UTC is 12:03 pm in Brisbane.
    expect(fmtDateTimeAU('2026-11-23T02:03:00Z')).toBe('23/11/2026 12:03')
  })

  it('rolls the date forward for an early-morning Brisbane time', () => {
    expect(fmtDateTimeAU('2026-11-19T20:50:00Z')).toBe('20/11/2026 06:50')
  })

  it('writes midnight as 00, not 24', () => {
    expect(fmtDateTimeAU('2026-11-22T14:05:00Z')).toBe('23/11/2026 00:05')
  })

  it('returns an empty string for a value that is not a date', () => {
    expect(fmtDateTimeAU('not a date')).toBe('')
  })
})

describe('todayRows', () => {
  it('a job has no Diary row', () => {
    expect(todayRows(base).map((r) => r.key)).toEqual(['prestart', 'swms', 'day', 'photos'])
  })

  it('a project has a Diary row between Day sheet and Photos', () => {
    expect(todayRows({ ...base, diarySaved: false }).map((r) => r.key)).toEqual([
      'prestart', 'swms', 'day', 'diary', 'photos',
    ])
  })

  it('pre-start is a warning until it is done', () => {
    expect(chip(base, 'prestart')).toMatchObject({ chip: 'To do', tone: 'warn', tab: 'prestart' })
    expect(chip({ ...base, prestartSubmittedAt: '2026-11-19T20:50:00Z' }, 'prestart')).toMatchObject({
      chip: 'Done 6:50 am',
      tone: 'ok',
    })
  })

  it('SWMS reads none issued, n to sign, or all signed', () => {
    expect(chip(base, 'swms')).toMatchObject({ chip: 'None issued', tone: 'neutral' })
    expect(chip({ ...base, swmsTotal: 2, swmsToSign: 1 }, 'swms')).toMatchObject({
      chip: '1 to sign',
      tone: 'warn',
    })
    expect(chip({ ...base, swmsTotal: 2, swmsToSign: 0 }, 'swms')).toMatchObject({
      chip: 'All signed',
      tone: 'ok',
    })
  })

  it('day sheet and photos count what is there', () => {
    expect(chip(base, 'day')?.chip).toBe('Nothing yet')
    expect(chip({ ...base, usageCount: 3 }, 'day')?.chip).toBe('3 logged')
    expect(chip(base, 'photos')?.chip).toBe('None today')
    expect(chip({ ...base, photoCount: 6 }, 'photos')?.chip).toBe('6 today')
  })

  it('diary reads saved or not started', () => {
    expect(chip({ ...base, diarySaved: true }, 'diary')).toMatchObject({ chip: 'Saved', tone: 'ok' })
    expect(chip({ ...base, diarySaved: false }, 'diary')?.chip).toBe('Not started')
  })
})

describe('hoursBetween and fmtDuration', () => {
  const now = new Date('2026-11-20T00:00:00Z')

  it('a closed entry uses its own finish', () => {
    expect(hoursBetween('2026-11-19T20:00:00Z', '2026-11-19T22:30:00Z', now)).toBe(2.5)
  })

  it('an open entry runs to now', () => {
    expect(hoursBetween('2026-11-19T20:42:00Z', null, now)).toBeCloseTo(3.3, 5)
  })

  it('never goes negative', () => {
    expect(hoursBetween('2026-11-20T02:00:00Z', '2026-11-20T01:00:00Z', now)).toBe(0)
  })

  it('formats as hours and minutes', () => {
    expect(fmtDuration(3.3)).toBe('3 h 18 m')
    expect(fmtDuration(0)).toBe('0 h 00 m')
    expect(fmtDuration(8)).toBe('8 h 00 m')
  })
})
