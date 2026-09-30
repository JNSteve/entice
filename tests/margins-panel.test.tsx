// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

vi.mock('next/link', () => ({
  default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a>,
}))

import { MarginsPanel } from '@/app/(office)/margins-panel'
import type { PortfolioRow } from '@/lib/pnl-portfolio'

afterEach(cleanup)

function row(r: Partial<PortfolioRow> & { id: string }): PortfolioRow {
  return {
    kind: 'job', number: r.id.toUpperCase(), title: `Job ${r.id}`, status: 'in_progress', stage: 'live',
    closedOn: null, href: `/jobs/${r.id}`, price: 1000, cost: 0, margin: 1000, marginPct: 100,
    drawdownPct: 0, pendingHours: 0, ...r,
  }
}

const rows = [
  row({ id: 'a', cost: 500, margin: 500, marginPct: 50, drawdownPct: 50 }),
  row({ id: 'b', cost: 1200, margin: -200, marginPct: -20, drawdownPct: 120 }),
  row({ id: 'c', stage: 'closed', status: 'paid', closedOn: '2026-08-10', price: 2000, cost: 1500, margin: 500, marginPct: 25, drawdownPct: 75 }),
  row({ id: 'd', stage: 'closed', status: 'paid', closedOn: '2026-09-01', price: 2000, cost: 1900, margin: 100, marginPct: 5, drawdownPct: 95 }),
  row({ id: 'e', stage: 'closed', status: 'paid', closedOn: '2025-01-01', price: 5000, cost: 1000, margin: 4000, marginPct: 80, drawdownPct: 20 }),
]

test('live tab ranks losses first and counts at-risk work', () => {
  render(<MarginsPanel data={{ rows, today: '2026-09-30' }} />)
  const links = screen.getAllByRole('link').map((l) => l.textContent)
  expect(links[0]).toContain('B')
  expect(screen.getByText('At risk').parentElement?.textContent).toContain('1')
  expect(screen.getAllByText('Headroom')[0].parentElement?.textContent).toContain('$300.00')
})

test('closed tab shows this FY by default with a weighted average', async () => {
  const user = userEvent.setup()
  render(<MarginsPanel data={{ rows, today: '2026-09-30' }} />)
  await user.click(screen.getByRole('radio', { name: 'Closed out' }))
  const avg = screen.getByText('Average margin').parentElement!
  expect(within(avg).getByText('15.0%')).toBeTruthy() // (500 + 100) / 4000
  expect(screen.queryByText(/Job e/)).toBeNull()
  await user.click(screen.getByRole('radio', { name: 'All time' }))
  expect(screen.getAllByText(/Job e/).length).toBeGreaterThan(0)
})

test('load failure shows an error instead of crashing', () => {
  render(<MarginsPanel data={null} />)
  expect(screen.getByText(/Couldn.t load this card/)).toBeTruthy()
})
