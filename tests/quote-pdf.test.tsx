import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { QuotePdf } from '../src/pdf/QuotePdf'
import { DEFAULT_PRICING } from '../src/lib/quote-doc'

const company = { name: 'Test Civil Pty Ltd', abn: '11 222 333 444', address: '1 Test St', phone: null, email: null, logoUrl: undefined }
const sections = [
  { title: 'Preparation', lines: [{ description: 'Site setup', qty: 3, unit: 'ea', unit_sell: 100 }] },
  { title: 'Materials', lines: [{ description: 'Membrane', qty: 1, unit: 'm2', unit_sell: 250.5 }] },
]
const totals = { subtotal: 550.5, gst: 55.05, gstRate: 10, total: 605.55 }

for (const mode of ['itemised', 'section_totals', 'lump_sum'] as const) {
  test(`standard quote pdf renders in ${mode} mode`, async () => {
    const buffer = await renderToBuffer(
      <QuotePdf
        quote={{ number: 'Q-0001', title: 'Roof restoration', date: '26/08/2026', clientName: 'Acme', contactName: 'Dan', siteName: 'Depot', siteAddress: '1 Site Rd' }}
        company={company}
        sections={sections}
        totals={totals}
        validDays={14}
        description="Scope"
        quoteFooter="Fine print"
        display={{ ...DEFAULT_PRICING, mode, fee_label: 'Fixed fee' }}
      />
    )
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1000)
  })
}

test('standard quote pdf renders without a display prop (legacy call)', async () => {
  const buffer = await renderToBuffer(
    <QuotePdf
      quote={{ number: 'Q-0002', title: 'T', date: '26/08/2026', clientName: 'Acme' }}
      company={company}
      sections={sections}
      totals={totals}
      validDays={30}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
})
