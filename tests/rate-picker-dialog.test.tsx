// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const addLine = vi.fn()
const refresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  addLine: (...args: unknown[]) => addLine(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

import { RatePickerDialog } from '../src/app/(office)/quotes/[id]/rate-picker-dialog'
import type { RateItemData } from '../src/app/(office)/quotes/[id]/quote-builder'

const rates: RateItemData[] = [
  { id: 'r-bins', kind: 'other', name: '15m3 general waste bins', unit: 'ea', cost: 800, default_markup_pct: 0 },
  { id: 'r-movers', kind: 'plant', name: 'Air movers', unit: 'day', cost: 60, default_markup_pct: 0 },
  { id: 'r-bags', kind: 'consumable', name: 'Asbestos Bags Large', unit: 'roll', cost: 147.4, default_markup_pct: 0 },
]

beforeEach(() => {
  // jsdom lacks these; Base UI's popup layer reads them.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  addLine.mockReset()
  refresh.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})
afterEach(cleanup)

async function openDialog(onAdded = vi.fn()) {
  render(<RatePickerDialog quoteId="q-1" sectionId="s-1" rateItems={rates} onAdded={onAdded} />)
  fireEvent.click(screen.getByRole('button', { name: /add from rates/i }))
  await screen.findByText('Add from rate library')
  return onAdded
}

/** Rate rows are disabled while an add is in flight; wait for the real one. */
async function pickWhenEnabled(name: RegExp) {
  await waitFor(() => {
    const el = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(el.disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('RatePickerDialog', () => {
  test('picking a rate adds it, keeps the dialog open and hands back the new line id', async () => {
    addLine.mockResolvedValueOnce({ id: 'line-9' })
    const onAdded = await openDialog()

    await pickWhenEnabled(/air movers/i)

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('line-9'))
    expect(addLine).toHaveBeenCalledWith({
      quote_id: 'q-1',
      section_id: 's-1',
      rate_item_id: 'r-movers',
    })
    expect(screen.getByText('Add from rate library')).toBeTruthy()
    expect(screen.getByText('1 added')).toBeTruthy()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    // The whole list is still there to pick from again.
    expect(screen.getByRole('button', { name: /waste bins/i })).toBeTruthy()
  })

  test('several picks in a row count up and the search is kept', async () => {
    addLine.mockResolvedValueOnce({ id: 'line-1' }).mockResolvedValueOnce({ id: 'line-2' })
    const onAdded = await openDialog()
    fireEvent.change(screen.getByPlaceholderText(/search rates/i), { target: { value: 'a' } })

    await pickWhenEnabled(/air movers/i)
    await waitFor(() => expect(screen.getByText('1 added')).toBeTruthy())
    await pickWhenEnabled(/asbestos bags/i)
    await waitFor(() => expect(screen.getByText('2 added')).toBeTruthy())

    expect(onAdded.mock.calls).toEqual([['line-1'], ['line-2']])
    expect((screen.getByPlaceholderText(/search rates/i) as HTMLInputElement).value).toBe('a')
    expect(screen.getByText('Add from rate library')).toBeTruthy()
  })

  test('the picked row says Added so a click is visibly confirmed', async () => {
    addLine.mockResolvedValueOnce({ id: 'line-1' })
    await openDialog()
    await pickWhenEnabled(/air movers/i)
    const row = await screen.findByRole('button', { name: /air movers/i })
    await waitFor(() => expect(row.textContent).toMatch(/added/i))
  })

  test('an error is reported, nothing is counted and the dialog stays put', async () => {
    addLine.mockResolvedValueOnce({ error: 'Quote is locked' })
    const onAdded = await openDialog()
    await pickWhenEnabled(/air movers/i)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Quote is locked'))
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.queryByText(/added/i)).toBeNull()
    expect(screen.getByText('Add from rate library')).toBeTruthy()
  })

  test('Done closes the dialog', async () => {
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => expect(screen.queryByText('Add from rate library')).toBeNull())
  })
})
