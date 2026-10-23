// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const updateLine = vi.fn()
const refresh = vi.fn()
const toastError = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  updateLine: (...args: unknown[]) => updateLine(...args),
  moveLine: vi.fn(),
  deleteLine: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
}))

import { LineRow, type LineData } from '../src/app/(office)/quotes/[id]/line-row'

function line(overrides: Partial<LineData> = {}): LineData {
  return {
    id: 'l-1',
    section_id: 's-1',
    position: 0,
    description: 'Site vehicle',
    qty: 25,
    unit: 'ea',
    unit_cost: 130,
    markup_pct: 0,
    unit_sell: 130,
    kind: null,
    locked: false,
    ...overrides,
  }
}

beforeEach(() => {
  updateLine.mockReset()
  updateLine.mockResolvedValue({})
  refresh.mockReset()
  toastError.mockReset()
})
afterEach(cleanup)

describe('LineRow category', () => {
  test('editable row offers the six categories and saves a change with kind', async () => {
    render(<LineRow line={line()} editable isFirst isLast />)
    const select = screen.getByLabelText('Category') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      'Uncategorised',
      'Labour',
      'Plant & equipment',
      'Materials',
      'Subcontract',
      'Other',
    ])
    expect(select.value).toBe('')

    fireEvent.change(select, { target: { value: 'plant' } })

    await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
    expect(updateLine).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({ kind: 'plant', description: 'Site vehicle', unit_sell: 130 })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  test('clearing the category saves kind null', async () => {
    render(<LineRow line={line({ kind: 'labour' })} editable isFirst isLast />)
    const select = screen.getByLabelText('Category') as HTMLSelectElement
    expect(select.value).toBe('labour')
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() =>
      expect(updateLine).toHaveBeenCalledWith('l-1', expect.objectContaining({ kind: null }))
    )
  })

  test('other field saves carry the current kind', async () => {
    render(<LineRow line={line({ kind: 'labour' })} editable isFirst isLast />)
    const qty = screen.getByLabelText('Quantity')
    fireEvent.change(qty, { target: { value: '3' } })
    fireEvent.blur(qty)
    await waitFor(() =>
      expect(updateLine).toHaveBeenCalledWith('l-1', expect.objectContaining({ kind: 'labour', qty: 3 }))
    )
  })

  test('read-only row shows the label, or a dash when uncategorised', () => {
    const { unmount } = render(<LineRow line={line({ kind: 'subbie' })} editable={false} isFirst isLast />)
    expect(screen.getByText('Subcontract')).toBeTruthy()
    unmount()
    render(<LineRow line={line()} editable={false} isFirst isLast />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  test('a failed category save reverts the select and reports the error', async () => {
    updateLine.mockResolvedValueOnce({ error: 'Quote is not editable' })
    render(<LineRow line={line({ kind: 'labour' })} editable isFirst isLast />)
    const select = screen.getByLabelText('Category') as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'plant' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Quote is not editable'))
    await waitFor(() => expect(select.value).toBe('labour'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
