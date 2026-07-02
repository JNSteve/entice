import { expect, test, vi, afterEach } from 'vitest'
import { todayAUClient, nowAUInput, instantToAUInput } from '../src/lib/tz-client'
import { auLocalToInstant } from '../src/lib/tz'

afterEach(() => {
  vi.useRealTimers()
})

test('todayAUClient rolls to the Brisbane calendar day', () => {
  // 2026-06-24 23:30 UTC = 2026-06-25 09:30 Brisbane (+10)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-24T23:30:00Z'))
  expect(todayAUClient()).toBe('2026-06-25')
})

test('instantToAUInput converts a stored UTC instant to Brisbane wall-clock', () => {
  // 2026-07-01 22:00 UTC = 2026-07-02 08:00 Brisbane (+10)
  expect(instantToAUInput('2026-07-01T22:00:00.000Z')).toBe('2026-07-02T08:00')
  // Afternoon same-day case
  expect(instantToAUInput('2026-07-02T05:30:00.000Z')).toBe('2026-07-02T15:30')
})

test('nowAUInput returns the current Brisbane wall-clock as datetime-local', () => {
  // 2026-06-24 23:30 UTC = 2026-06-25 09:30 Brisbane (+10)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-24T23:30:00Z'))
  expect(nowAUInput()).toBe('2026-06-25T09:30')
})

test('nowAUInput → auLocalToInstant round-trips to the true instant', () => {
  // 2026-06-24 23:30 UTC exactly (no minutes lost — datetime-local drops seconds)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-24T23:30:00Z'))
  expect(auLocalToInstant(nowAUInput())).toBe('2026-06-24T23:30:00.000Z')
})

test('instantToAUInput ⇄ auLocalToInstant round-trips (minute precision)', () => {
  const stored = '2026-07-01T22:00:00.000Z'
  const input = instantToAUInput(stored) // '2026-07-02T08:00'
  expect(input).toBe('2026-07-02T08:00')
  expect(auLocalToInstant(input)).toBe(stored)
})
