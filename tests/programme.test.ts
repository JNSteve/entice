import { expect, test } from 'vitest'
import {
  computeAutoShifts,
  detectCycle,
  getDescendants,
} from '../src/lib/programme-logic'

const link = (predecessor_id: string, successor_id: string) => ({
  predecessor_id,
  successor_id,
})

// ─── detectCycle ──────────────────────────────────────────────────────────────

test('detectCycle: empty / linear chain has no cycle', () => {
  expect(detectCycle([])).toBe(false)
  expect(detectCycle([link('a', 'b'), link('b', 'c'), link('c', 'd')])).toBe(false)
})

test('detectCycle: direct two-node cycle', () => {
  expect(detectCycle([link('a', 'b')], link('b', 'a'))).toBe(true)
})

test('detectCycle: transitive cycle a→b→c→a', () => {
  expect(detectCycle([link('a', 'b'), link('b', 'c')], link('c', 'a'))).toBe(true)
})

test('detectCycle: self-link is a cycle', () => {
  expect(detectCycle([], link('a', 'a'))).toBe(true)
})

test('detectCycle: diamond (a→b, a→c, b→d, c→d) is not a cycle', () => {
  expect(
    detectCycle([link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')])
  ).toBe(false)
})

test('detectCycle: new link that only fans out is fine', () => {
  expect(detectCycle([link('a', 'b'), link('b', 'c')], link('a', 'c'))).toBe(false)
})

// ─── getDescendants ───────────────────────────────────────────────────────────

test('getDescendants: transitive successors only', () => {
  const links = [link('a', 'b'), link('b', 'c'), link('x', 'a'), link('c', 'd')]
  expect(getDescendants(links, 'a')).toEqual(new Set(['b', 'c', 'd']))
  expect(getDescendants(links, 'd')).toEqual(new Set())
})

// ─── computeAutoShifts ────────────────────────────────────────────────────────

const t = (id: string, start_date: string, end_date: string) => ({
  id,
  start_date,
  end_date,
})

test('auto-shift: no-op when no violation', () => {
  const tasks = [t('a', '2026-01-01', '2026-01-10'), t('b', '2026-01-11', '2026-01-20')]
  expect(computeAutoShifts(tasks, [link('a', 'b')], 'a')).toEqual([])
})

test('auto-shift: successor pushed to predecessor end + 1, duration preserved', () => {
  const tasks = [
    t('a', '2026-01-01', '2026-01-15'), // a now ends after b starts
    t('b', '2026-01-10', '2026-01-19'), // 10 days
  ]
  const shifts = computeAutoShifts(tasks, [link('a', 'b')], 'a')
  expect(shifts).toEqual([{ id: 'b', newStart: '2026-01-16', newEnd: '2026-01-25' }])
})

test('auto-shift: cascade through a chain of 3', () => {
  const tasks = [
    t('a', '2026-01-01', '2026-01-12'),
    t('b', '2026-01-10', '2026-01-14'), // 5 days, violated by a
    t('c', '2026-01-15', '2026-01-16'), // 2 days, violated once b shifts
  ]
  const links = [link('a', 'b'), link('b', 'c')]
  const shifts = computeAutoShifts(tasks, links, 'a')
  expect(shifts).toHaveLength(2)
  expect(shifts.find((s) => s.id === 'b')).toEqual({
    id: 'b',
    newStart: '2026-01-13',
    newEnd: '2026-01-17',
  })
  // c starts the day after b's new end, keeping its 2-day duration
  expect(shifts.find((s) => s.id === 'c')).toEqual({
    id: 'c',
    newStart: '2026-01-18',
    newEnd: '2026-01-19',
  })
})

test('auto-shift: cascade stops where the gap is already big enough', () => {
  const tasks = [
    t('a', '2026-01-01', '2026-01-12'),
    t('b', '2026-01-10', '2026-01-14'),
    t('c', '2026-03-01', '2026-03-05'), // far in the future — untouched
  ]
  const links = [link('a', 'b'), link('b', 'c')]
  const shifts = computeAutoShifts(tasks, links, 'a')
  expect(shifts.map((s) => s.id)).toEqual(['b'])
})

test('auto-shift: start equal to predecessor end counts as a violation', () => {
  const tasks = [t('a', '2026-01-01', '2026-01-10'), t('b', '2026-01-10', '2026-01-10')]
  const shifts = computeAutoShifts(tasks, [link('a', 'b')], 'a')
  expect(shifts).toEqual([{ id: 'b', newStart: '2026-01-11', newEnd: '2026-01-11' }])
})

test('auto-shift: converging predecessors — later predecessor wins', () => {
  const tasks = [
    t('a', '2026-01-01', '2026-01-20'),
    t('b', '2026-01-01', '2026-01-05'),
    t('c', '2026-01-06', '2026-01-08'), // succ of both a and b
  ]
  const links = [link('a', 'c'), link('b', 'c')]
  const shifts = computeAutoShifts(tasks, links, 'a')
  expect(shifts).toEqual([{ id: 'c', newStart: '2026-01-21', newEnd: '2026-01-23' }])
})

test('auto-shift: unknown changed task or task missing from list is a no-op', () => {
  const tasks = [t('a', '2026-01-01', '2026-01-10')]
  expect(computeAutoShifts(tasks, [link('a', 'b')], 'zzz')).toEqual([])
  // link target not in tasks — ignored rather than crashing
  expect(computeAutoShifts(tasks, [link('a', 'b')], 'a')).toEqual([])
})

test('auto-shift: terminates on a (malformed) cyclic graph', () => {
  const tasks = [
    t('a', '2026-01-01', '2026-01-10'),
    t('b', '2026-01-05', '2026-01-12'),
  ]
  const links = [link('a', 'b'), link('b', 'a')]
  const shifts = computeAutoShifts(tasks, links, 'a')
  // Must return (cycle guard) — exact shift values are not meaningful here.
  expect(Array.isArray(shifts)).toBe(true)
})
