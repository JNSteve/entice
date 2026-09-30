// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

vi.mock('@/lib/pnl-actions', () => ({
  addCostLine: vi.fn(), updateCostLine: vi.fn(), deleteCostLine: vi.fn(),
  addPriceAdjustment: vi.fn(), deletePriceAdjustment: vi.fn(), setJobBasePrice: vi.fn(),
}))
vi.mock('next/link', () => ({ default: (p: { children: React.ReactNode }) => <a>{p.children}</a> }))

import { PnlPanel } from '@/components/pnl/PnlPanel'
import { computePnl } from '@/lib/pnl'
import type { PnlData } from '@/lib/pnl-queries'

afterEach(cleanup)

test('job P&L shows ex GST figures with inc GST equivalents', () => {
  const data: PnlData = {
    summary: computePnl({ basePrice: 2250, adjustments: [750], timesheets: [], costs: [] }),
    price: {
      mode: 'job', basePrice: 2250, hasQuote: true, quoteNumber: 'RQ26013',
      adjustments: [{ id: 'a1', date: '2026-09-25', description: 'Agreed price', amount: 750 }],
    },
    gstRate: 10,
    costLines: [], workers: [], costCodes: [],
  }
  render(<PnlPanel parentType="job" parentId="j1" data={data} />)
  expect(screen.getByText('Price (ex GST)')).toBeTruthy()
  expect(screen.getByText('$3,300.00 inc GST')).toBeTruthy()
  expect(screen.getByText('Accepted quote RQ26013')).toBeTruthy()
  expect(screen.getByText('$2,475.00')).toBeTruthy()
  expect(screen.getByText('+$825.00')).toBeTruthy()
  expect(screen.getAllByText('$3,300.00').length).toBeGreaterThan(0)
})
