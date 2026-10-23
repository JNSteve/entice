// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const addLine = vi.fn()
const refresh = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  addLine: (...args: unknown[]) => addLine(...args),
  updateLine: vi.fn(),
  setLineLocked: vi.fn(),
  moveLine: vi.fn(),
  deleteLine: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LinesGrid } from '../src/app/(office)/quotes/[id]/lines-grid'
import type { LineData } from '../src/app/(office)/quotes/[id]/line-row'

const QUOTE_ID = '11111111-1111-4111-8111-111111111111'
const SECTION_ID = '22222222-2222-4222-8222-222222222222'

function line(
  id: string,
  kind: string | null,
  position: number,
  overrides: Partial<LineData> = {}
): LineData {
  return {
    id,
    section_id: SECTION_ID,
    position,
    description: id,
    qty: 1,
    unit: 'ea',
    unit_cost: 10,
    markup_pct: 0,
    unit_sell: 10,
    kind,
    locked: false,
    rate_item_id: null,
    ...overrides,
  }
}

// Deliberately out of category order, as stored positions would be on a
// quote built before grouping existed.
const LINES: LineData[] = [
  line('plastic', 'material', 0, { qty: 26, unit_sell: 119.18 }),
  line('vehicle', 'plant', 0, { qty: 25, unit_sell: 130 }),
  line('scaffold', 'plant', 1, { qty: 25, unit_sell: 100 }),
  line('tip fees', null, 0, { qty: 1, unit_sell: 400 }),
]

beforeEach(() => {
  addLine.mockReset()
  addLine.mockResolvedValue({})
  refresh.mockReset()
})
afterEach(cleanup)

describe('LinesGrid', () => {
  test('groups lines by category in fixed order with sell subtotals, skipping empty groups', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)

    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Plant & equipment',
      'Materials',
      'Uncategorised',
    ])
    expect(
      within(groups[0])
        .getAllByLabelText('Description')
        .map((i) => (i as HTMLInputElement).value)
    ).toEqual(['vehicle', 'scaffold'])
    // Two-line group: the subtotal is the only element showing this amount.
    expect(within(groups[0]).getByText('$5,750.00')).toBeTruthy()
    // Single-line groups: the amount appears twice — the line's own total and
    // the group subtotal.
    expect(within(groups[1]).getAllByText('$3,098.68')).toHaveLength(2)
    expect(within(groups[2]).getAllByText('$400.00')).toHaveLength(2)
  })

  test('column headings include Category', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    expect(screen.getByText('Category')).toBeTruthy()
  })

  test('per-group Add line creates a line in that category', async () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Add line to Plant & equipment' }))
    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith({ quote_id: QUOTE_ID, section_id: SECTION_ID, kind: 'plant' })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  test('uncategorised Add line sends no kind', async () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Add line to Uncategorised' }))
    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith({ quote_id: QUOTE_ID, section_id: SECTION_ID })
    )
  })

  test('read-only grid keeps the groups but has no buttons', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable={false} />)
    expect(screen.getAllByRole('group')).toHaveLength(3)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  test('orphaned lines (no section) get no per-group Add line', () => {
    render(
      <LinesGrid
        quoteId={QUOTE_ID}
        sectionId={null}
        lines={LINES.map((l) => ({ ...l, section_id: null }))}
        editable
      />
    )
    expect(screen.getAllByRole('group')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Add line/ })).toBeNull()
  })

  test('arrows are gated per group, not across the section', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    const groups = screen.getAllByRole('group')

    // Plant & equipment has two lines: vehicle first, scaffold last.
    const plantUp = within(groups[0]).getAllByRole('button', { name: 'Move line up' })
    const plantDown = within(groups[0]).getAllByRole('button', { name: 'Move line down' })
    expect(plantUp.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, false])
    expect(plantDown.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, true])

    // Materials has one line: both arrows disabled even though plant lines
    // sit above it in the section.
    const materials = within(groups[1])
    expect((materials.getByRole('button', { name: 'Move line up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((materials.getByRole('button', { name: 'Move line down' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('empty list shows the placeholder', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={[]} editable />)
    expect(screen.getByText('No lines yet.')).toBeTruthy()
  })
})

describe('LinesGrid duplicates', () => {
  function rowOf(description: string | RegExp) {
    return screen.getByDisplayValue(description).closest('.grid') as HTMLElement
  }

  test('lines sharing a rate item are tinted blue; a lone one is not', () => {
    render(
      <LinesGrid
        quoteId={QUOTE_ID}
        sectionId={SECTION_ID}
        editable
        lines={[
          line('a', 'plant', 0, { description: 'Air movers', rate_item_id: 'r-movers' }),
          line('b', 'plant', 1, { description: 'Air movers (upstairs)', rate_item_id: 'r-movers' }),
          line('c', 'plant', 2, { description: 'Bobcat', rate_item_id: 'r-bobcat' }),
        ]}
      />
    )
    expect(rowOf('Air movers').className).toMatch(/sky/)
    expect(rowOf('Air movers (upstairs)').className).toMatch(/sky/)
    expect(rowOf('Bobcat').className).not.toMatch(/sky/)
  })

  test('manual lines with the same wording count too, whatever the case and spacing', () => {
    render(
      <LinesGrid
        quoteId={QUOTE_ID}
        sectionId={SECTION_ID}
        editable
        lines={[
          line('a', null, 0, { description: 'Tip fees' }),
          line('b', null, 1, { description: ' tip  FEES ' }),
          line('c', null, 2, { description: 'Tip fees (extra)' }),
          line('d', null, 3, { description: '' }),
          line('e', null, 4, { description: '' }),
        ]}
      />
    )
    expect(rowOf('Tip fees').className).toMatch(/sky/)
    expect(rowOf(/tip\s+FEES/).className).toMatch(/sky/)
    expect(rowOf('Tip fees (extra)').className).not.toMatch(/sky/)
    // Two blank lines are just blank, not duplicates of each other.
    const blanks = screen.getAllByLabelText('Description').filter((i) => (i as HTMLInputElement).value === '')
    expect(blanks).toHaveLength(2)
    for (const b of blanks) expect((b.closest('.grid') as HTMLElement).className).not.toMatch(/sky/)
  })
})
