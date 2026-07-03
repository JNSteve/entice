import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { PoPdf } from '../src/pdf/PoPdf'

const company = {
  name: 'Test Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW',
  phone: '02 9000 0000',
  email: 'office@test.example',
  logoUrl: undefined,
}

test('po pdf renders (supplier block, lines, totals)', async () => {
  const buffer = await renderToBuffer(
    <PoPdf
      po={{
        number: 'PO-0001',
        date: '12/06/2026',
        vendorName: 'Acme Electrical',
        vendorEmail: 'orders@acme.example',
        vendorPhone: '0400 000 000',
        deliverTo: 'Riverbank Stabilisation — 1 Site Rd, Brisbane QLD',
        notes: 'Deliver to site office.',
        status: 'issued',
      }}
      company={company}
      lines={[
        {
          description: 'Cable trays',
          cost_code: '30 — Electrical',
          qty: 12,
          unit: 'ea',
          unit_cost: 85,
        },
        {
          description: 'Labour — install',
          cost_code: null,
          qty: 8,
          unit: 'hr',
          unit_cost: 110,
        },
      ]}
      totals={{ subtotal: 1900, gst: 190, gstRate: 0.1, total: 2090 }}
    />
  )
  // %PDF magic bytes + non-trivial size
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})
