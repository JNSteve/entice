// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const updateLine = vi.fn(async () => ({}))
const setLineLocked = vi.fn(async (): Promise<{ error?: string }> => ({}))
const refresh = vi.fn()
const toastError = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  updateLine: (...args: unknown[]) => updateLine(...(args as [])),
  setLineLocked: (...args: unknown[]) => setLineLocked(...(args as [])),
  moveLine: vi.fn(async () => ({})),
  deleteLine: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
}))

import { LineRow, type LineData } from '../src/app/(office)/quotes/[id]/line-row'

afterEach(cleanup)
beforeEach(() => {
  updateLine.mockClear()
  setLineLocked.mockClear()
  setLineLocked.mockResolvedValue({})
  refresh.mockClear()
  toastError.mockClear()
})

function line(overrides: Partial<LineData> = {}): LineData {
  return {
    id: 'line-1',
    section_id: 'sec-1',
    position: 0,
    description: 'Supervisor',
    qty: 1,
    unit: 'hr',
    unit_cost: 100,
    markup_pct: 0,
    unit_sell: 100,
    kind: 'labour',
    locked: false,
    rate_item_id: null,
    ...overrides,
  }
}

function renderRow(data: LineData) {
  return render(<LineRow line={data} editable isFirst isLast />)
}

async function typeSell(user: ReturnType<typeof userEvent.setup>, value: string) {
  const sell = screen.getByLabelText('Unit sell')
  await user.click(sell)
  await user.clear(sell)
  await user.type(sell, value)
  await user.tab()
}

test('typing a unit sell derives the markup % from the cost', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 0, unit_sell: 100 }))

  await typeSell(user, '180')

  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('80')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 100, markup_pct: 80, unit_sell: 180, sell_overridden: false })
  )
})

test('a sell below cost gives a negative markup', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 20, unit_sell: 120 }))

  await typeSell(user, '90')

  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('-10')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ markup_pct: -10, unit_sell: 90, sell_overridden: false })
  )
})

test('a sell the 2dp markup cannot reproduce keeps the typed sell as an override', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 1234.56, markup_pct: 0, unit_sell: 1234.56 }))

  await typeSell(user, '1500')

  // (1500 / 1234.56 - 1) * 100 = 21.5008… → 21.5, and 1234.56 × 1.215 = 1499.99, not 1500.
  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('21.5')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ markup_pct: 21.5, unit_sell: 1500, sell_overridden: true })
  )
})

test('with no cost the markup is left alone and the sell is an override', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 0, markup_pct: 20, unit_sell: 0 }))

  await typeSell(user, '50')

  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('20')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ markup_pct: 20, unit_sell: 50, sell_overridden: true })
  )
})

async function typeCost(user: ReturnType<typeof userEvent.setup>, value: string) {
  const cost = screen.getByLabelText('Unit cost')
  await user.click(cost)
  await user.clear(cost)
  await user.type(cost, value)
  await user.tab()
}

test('editing the cost keeps the sell and re-derives the markup', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 80, unit_sell: 180 }))

  await typeCost(user, '120')

  expect((screen.getByLabelText('Unit sell') as HTMLInputElement).value).toBe('180.00')
  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('50')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 120, markup_pct: 50, unit_sell: 180, sell_overridden: false })
  )
})

test('a cost above the sell gives a negative markup, sell untouched', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 20, unit_sell: 120 }))

  await typeCost(user, '150')

  expect((screen.getByLabelText('Unit sell') as HTMLInputElement).value).toBe('120.00')
  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('-20')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 150, markup_pct: -20, unit_sell: 120, sell_overridden: false })
  )
})

test('entering a cost on a line with no sell yet seeds the sell from the markup', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 0, markup_pct: 20, unit_sell: 0 }))

  await typeCost(user, '100')

  expect((screen.getByLabelText('Unit sell') as HTMLInputElement).value).toBe('120.00')
  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('20')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 100, markup_pct: 20, unit_sell: 120, sell_overridden: false })
  )
})

test('clearing the cost to 0 keeps the sell as an override and leaves the markup', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 80, unit_sell: 180 }))

  await typeCost(user, '0')

  expect((screen.getByLabelText('Unit sell') as HTMLInputElement).value).toBe('180.00')
  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('80')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 0, markup_pct: 80, unit_sell: 180, sell_overridden: true })
  )
})

test('typing a markup still sets the sell from the cost', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 80, unit_sell: 180 }))

  const markup = screen.getByLabelText('Markup %')
  await user.click(markup)
  await user.clear(markup)
  await user.type(markup, '25')
  // Blur onto a plain field: tabbing would land in the Unit sell input, which
  // snapshots its text on focus before jsdom lets React re-render.
  await user.click(screen.getByLabelText('Description'))

  expect((screen.getByLabelText('Unit sell') as HTMLInputElement).value).toBe('125.00')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 100, markup_pct: 25, unit_sell: 125, sell_overridden: false })
  )
})

const FIELD_LABELS = [
  'Description',
  'Category',
  'Quantity',
  'Unit',
  'Unit cost',
  'Markup %',
  'Unit sell',
] as const

function fieldDisabled(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).disabled
}

function buttonDisabled(name: string) {
  return (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
}

test('pressing the padlock locks the line: saves locked and disables every field and delete, not the arrows', async () => {
  const user = userEvent.setup()
  render(<LineRow line={line()} editable isFirst={false} isLast={false} />)
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => false))

  await user.click(screen.getByRole('button', { name: 'Lock line' }))

  await waitFor(() => expect(setLineLocked).toHaveBeenCalledWith('line-1', true))
  const unlock = screen.getByRole('button', { name: 'Unlock line' })
  expect(unlock.getAttribute('aria-pressed')).toBe('true')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => true))
  expect(buttonDisabled('Delete line')).toBe(true)
  await waitFor(() => expect(buttonDisabled('Move line up')).toBe(false))
  expect(buttonDisabled('Move line down')).toBe(false)
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

test('a locked line renders frozen and the padlock unlocks it', async () => {
  const user = userEvent.setup()
  renderRow(line({ locked: true }))

  const unlock = screen.getByRole('button', { name: 'Unlock line' })
  expect(unlock.getAttribute('aria-pressed')).toBe('true')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => true))
  expect(buttonDisabled('Delete line')).toBe(true)

  await user.click(unlock)

  await waitFor(() => expect(setLineLocked).toHaveBeenCalledWith('line-1', false))
  expect(screen.getByRole('button', { name: 'Lock line' }).getAttribute('aria-pressed')).toBe('false')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => false))
  await waitFor(() => expect(buttonDisabled('Delete line')).toBe(false))
})

test('a failed lock save reverts the padlock and reports the error', async () => {
  const user = userEvent.setup()
  setLineLocked.mockResolvedValueOnce({ error: 'Quote is accepted and can no longer be edited' })
  renderRow(line())

  await user.click(screen.getByRole('button', { name: 'Lock line' }))

  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith('Quote is accepted and can no longer be edited')
  )
  const lock = screen.getByRole('button', { name: 'Lock line' })
  expect(lock.getAttribute('aria-pressed')).toBe('false')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => false))
  expect(refresh).not.toHaveBeenCalled()
})

test('a read-only row shows no padlock', () => {
  render(<LineRow line={line({ locked: true })} editable={false} isFirst isLast />)
  expect(screen.queryByRole('button', { name: 'Unlock line' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Lock line' })).toBeNull()
})
