// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const commit = vi.fn(async (_p: unknown) => ({ added: 2, updated: 0, unchanged: 0, deactivated: 0, costsAdded: 1 }))
vi.mock('@/lib/price-list-actions', () => ({
  listSuppliers: vi.fn(async () => ['Allens Industrial']),
  loadSupplierMapping: vi.fn(async () => null),
  matchPriceLines: vi.fn(async (p: { lines: unknown[] }) => ({ statuses: p.lines.map(() => ({ status: 'new' })) })),
  commitPriceListImport: (p: unknown) => commit(p),
  extractPriceListPdf: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PriceListImport } from '@/components/price-list/PriceListImport'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('spreadsheet: map columns, review, save to price list and job (plant left off the job)', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(
    <PriceListImport
      open
      onClose={onClose}
      gstRate={10}
      job={{ parent_type: 'job', parent_id: '11450f03-f7a1-49f7-9296-ed48c8a809e1', label: 'RJ26013' }}
    />
  )
  await user.type(screen.getByLabelText('Supplier'), 'Allens Industrial')
  const csv = 'Item code,Description,UOM,Nett price,Category\nD85220,Black Plastic 200um,roll,99.313,Consumables\n107420416DOP,Nilfisk Vacuum,ea,1810,Equipment\n'
  const file = new File([csv], 'allens.csv', { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } })
  await user.click(screen.getByRole('button', { name: 'Read file' }))

  await screen.findByText('Match the columns')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Check before saving')

  expect((screen.getByLabelText('Add Black Plastic 200um to the job costs') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('Add Nilfisk Vacuum to the job costs') as HTMLInputElement).checked).toBe(false)
  await waitFor(() => expect(screen.getAllByText('New').length).toBe(2))

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(commit).toHaveBeenCalled())
  const payload = commit.mock.calls[0][0] as {
    supplier: string
    pricesIncludeGst: boolean
    lines: { name: string; unitPrice: number; kind: string; saveToList: boolean; addToJob: boolean }[]
    job: { parent_id: string } | null
    mapping: { name: number; cost: number } | null
  }
  expect(payload.supplier).toBe('Allens Industrial')
  expect(payload.pricesIncludeGst).toBe(false)
  expect(payload.lines).toEqual([
    expect.objectContaining({ name: 'Black Plastic 200um', unitPrice: 99.313, kind: 'consumable', saveToList: true, addToJob: true }),
    expect.objectContaining({ name: 'Nilfisk Vacuum', unitPrice: 1810, kind: 'plant', saveToList: true, addToJob: false }),
  ])
  expect(payload.job?.parent_id).toBe('11450f03-f7a1-49f7-9296-ed48c8a809e1')
  expect(payload.mapping).toMatchObject({ name: 1, cost: 3 })
  expect(onClose).toHaveBeenCalled()
})
