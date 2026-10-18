// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const updateLine = vi.fn(async () => ({}))
const refresh = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  updateLine: (...args: unknown[]) => updateLine(...(args as [])),
  moveLine: vi.fn(async () => ({})),
  deleteLine: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LineRow, type LineData } from '../src/app/(office)/quotes/[id]/line-row'

afterEach(cleanup)
beforeEach(() => {
  updateLine.mockClear()
  refresh.mockClear()
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

test('editing the cost still recomputes the sell from the markup', async () => {
  const user = userEvent.setup()
  renderRow(line({ unit_cost: 100, markup_pct: 20, unit_sell: 120 }))

  const cost = screen.getByLabelText('Unit cost')
  await user.click(cost)
  await user.clear(cost)
  await user.type(cost, '200')
  await user.tab()

  expect((screen.getByLabelText('Unit sell') as HTMLInputElement).value).toBe('240.00')
  expect((screen.getByLabelText('Markup %') as HTMLInputElement).value).toBe('20')
  await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
  expect(updateLine).toHaveBeenCalledWith(
    'line-1',
    expect.objectContaining({ unit_cost: 200, markup_pct: 20, unit_sell: 240, sell_overridden: false })
  )
})
