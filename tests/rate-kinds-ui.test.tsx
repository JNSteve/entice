// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'

vi.mock('../src/app/(office)/quotes/actions', () => ({
  addLine: vi.fn(async () => ({})),
  updateLine: vi.fn(async () => ({})),
  setLineLocked: vi.fn(async () => ({})),
  moveLine: vi.fn(async () => ({})),
  deleteLine: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LineRow, type LineData } from '../src/app/(office)/quotes/[id]/line-row'
import { RatePickerDialog } from '../src/app/(office)/quotes/[id]/rate-picker-dialog'
import { BUILTIN_RATE_KINDS } from '../src/lib/rate-kinds'

const kinds = [...BUILTIN_RATE_KINDS, { key: 'waste', label: 'Waste disposal', builtin: false }]

beforeEach(() => {
  // jsdom lacks these; Base UI's popup layer reads them.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(cleanup)

function line(overrides: Partial<LineData> = {}): LineData {
  return {
    id: 'line-1',
    section_id: 'sec-1',
    position: 0,
    description: 'Tip fees',
    qty: 1,
    unit: 't',
    unit_cost: 300,
    markup_pct: 0,
    unit_sell: 300,
    kind: 'waste',
    locked: false,
    rate_item_id: null,
    ...overrides,
  }
}

test('the category select lists a custom kind from the catalog and never consumable', () => {
  render(<LineRow line={line()} editable isFirst isLast rateKinds={kinds} />)
  const select = screen.getByLabelText('Category') as HTMLSelectElement
  expect(select.value).toBe('waste')
  const options = Array.from(select.options)
  expect(options.map((o) => o.textContent)).toContain('Waste disposal')
  expect(options.map((o) => o.value)).not.toContain('consumable')
  // The custom kind appears once: the catalog option, no fallback duplicate.
  expect(options.filter((o) => o.value === 'waste')).toHaveLength(1)
})

test('a kind the catalog no longer lists keeps its option so the select still shows it', () => {
  render(<LineRow line={line({ kind: 'gone' })} editable isFirst isLast />)
  const select = screen.getByLabelText('Category') as HTMLSelectElement
  expect(select.value).toBe('gone')
  expect(Array.from(select.options).map((o) => o.textContent)).toContain('gone')
})

test('the rate picker groups a custom kind under its catalog label, after the built-ins', async () => {
  const rates = [
    { id: 'r-tip', kind: 'waste', name: 'Tip fees', unit: 't', cost: 300, default_markup_pct: 0 },
    { id: 'r-movers', kind: 'plant', name: 'Air movers', unit: 'day', cost: 60, default_markup_pct: 0 },
  ]
  render(<RatePickerDialog quoteId="q-1" sectionId="s-1" rateItems={rates} rateKinds={kinds} />)
  fireEvent.click(screen.getByRole('button', { name: /add from rates/i }))
  await screen.findByText('Add from rate library')
  const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
  expect(headings).toEqual(['Plant & equipment', 'Waste disposal'])
})
