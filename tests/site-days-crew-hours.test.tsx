// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const setEntryApproved = vi.fn(async (...args: unknown[]) => {
  void args
  return {}
})
const updateEntryTimes = vi.fn(async (...args: unknown[]) => {
  void args
  return {}
})
const addTimesheetEntry = vi.fn(async (...args: unknown[]) => {
  void args
  return {}
})
const deleteTimesheetEntry = vi.fn(async (...args: unknown[]) => {
  void args
  return {}
})
vi.mock('@/app/(office)/site-days/actions', () => ({
  setEntryApproved: (...a: unknown[]) => setEntryApproved(...a),
  updateEntryTimes: (...a: unknown[]) => updateEntryTimes(...a),
  addTimesheetEntry: (...a: unknown[]) => addTimesheetEntry(...a),
  deleteTimesheetEntry: (...a: unknown[]) => deleteTimesheetEntry(...a),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CrewHours } from '@/app/(office)/site-days/[kind]/[id]/[date]/crew-hours'
import type { CrewEntry, DayRef } from '@/lib/site-days'

const dayRef: DayRef = { kind: 'job', workId: '11111111-1111-4111-8111-111111111111', date: '2026-11-20' }

// Brisbane is UTC+10: 20:42Z on the 19th = 06:42 on the 20th.
const rows: CrewEntry[] = [
  { id: 'e1', userId: 'u1', name: 'Sam', startAt: '2026-11-19T20:42:00Z', endAt: '2026-11-20T05:06:00Z', approved: true, unscheduled: false },
  { id: 'e2', userId: 'u2', name: 'Jo', startAt: '2026-11-19T20:45:00Z', endAt: '2026-11-20T05:00:00Z', approved: false, unscheduled: true },
  { id: 'e3', userId: 'u3', name: 'Ali', startAt: '2026-11-19T21:10:00Z', endAt: null, approved: false, unscheduled: false },
]
const people = [
  { id: 'u1', name: 'Sam' },
  { id: 'u4', name: 'Kim' },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('shows times, hours, the Unscheduled tag and an open entry', () => {
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  expect(screen.getByText('06:42')).toBeTruthy()
  expect(screen.getByText('15:06')).toBeTruthy()
  expect(screen.getByText('8.4')).toBeTruthy()
  expect(screen.getByText('Unscheduled')).toBeTruthy()
  expect(screen.getByText('Still checked in')).toBeTruthy()
})

test('ticking Approved calls the action with the day and entry', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('checkbox', { name: 'Approve hours for Jo' }))
  expect(setEntryApproved).toHaveBeenCalledWith(dayRef, 'e2', true)
})

test('an open entry cannot be approved', () => {
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  const box = screen.getByRole('checkbox', { name: 'Approve hours for Ali' })
  expect(box.getAttribute('aria-disabled') === 'true' || box.hasAttribute('disabled')).toBe(true)
})

test('editing times saves the new start and finish', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('button', { name: 'Edit hours for Jo' }))
  fireEvent.change(screen.getByLabelText('Finish time'), { target: { value: '15:10' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(updateEntryTimes).toHaveBeenCalledWith(dayRef, 'e2', '06:45', '15:10')
})

test('Set finish on an open entry opens the same editor', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('button', { name: 'Set finish' }))
  fireEvent.change(screen.getByLabelText('Finish time'), { target: { value: '15:30' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(updateEntryTimes).toHaveBeenCalledWith(dayRef, 'e3', '07:10', '15:30')
})

test('adding an entry sends the person and times', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('button', { name: 'Add entry' }))
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'u4' } })
  fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '07:00' } })
  fireEvent.change(screen.getByLabelText('New finish time'), { target: { value: '15:00' } })
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(addTimesheetEntry).toHaveBeenCalledWith(dayRef, 'u4', '07:00', '15:00')
})
