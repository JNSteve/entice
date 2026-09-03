import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { QuoteDocPdf } from '../src/pdf/QuoteDocPdf'
import { DEFAULT_PRICING, starterDoc, type QuoteDoc } from '../src/lib/quote-doc'
import { buildPricingModel } from '../src/lib/quote-pricing'

const company = { name: 'Test Civil Pty Ltd', abn: '11 222 333 444', address: '1 Test St', phone: null, email: null, logoUrl: undefined }
const sections = [{ title: 'Works', lines: [{ description: 'Attendance', qty: 1, unit: 'ea', unit_sell: 1500 }] }]
const totals = { subtotal: 1500, gst: 150, gstRate: 10, total: 1650 }
const details = [
  { label: 'Quote no.', value: 'RQ26003' },
  { label: 'Issue date', value: '26 August 2026' },
  { label: 'Prepared for', value: 'Malcolm Civil (ABN 52 663 107 757), Attn: Dan\n11/126 Compton Road' },
  { label: 'Prepared by', value: 'Nicholas Jones  |  Director' },
  { label: 'Validity', value: '14 days from issue' },
]

function doc(): QuoteDoc {
  const d = starterDoc()
  d.heading = 'Asbestos Inspection, Sampling and Close-out'
  d.blocks = [
    { id: '1', type: 'table', heading: 'Scope and Deliverables', intro: 'ECR will attend the pit.', columns: ['Service', 'Included scope'], rows: [{ label: 'Site attendance', value: 'One attendance by an LAA.' }] },
    { id: '2', type: 'pricing', heading: 'Fixed Fee', note: 'The fee is a fixed sum.' },
    { id: '3', type: 'bullets', heading: 'Key Assumptions', items: ['Safe access.', 'Water supply.'] },
    { id: '4', type: 'text', heading: 'Notes', body: 'First paragraph.\n\nSecond paragraph.' },
    { id: '5', type: 'acceptance', heading: 'Acceptance', body: 'Sign below.' },
  ]
  return d
}

for (const mode of ['lump_sum', 'section_totals', 'itemised'] as const) {
  test(`templated quote renders in ${mode} mode`, async () => {
    const buffer = await renderToBuffer(
      <QuoteDocPdf
        quote={{ number: 'RQ26003', title: 'Unexpected find, Port Drive', date: '26/08/2026' }}
        company={company}
        doc={doc()}
        details={details}
        pricing={buildPricingModel(sections, totals, { ...DEFAULT_PRICING, mode })}
        quoteFooter="Fine print"
      />
    )
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1000)
  })
}

test('templated quote renders portal acceptance evidence and a watermark', async () => {
  const buffer = await renderToBuffer(
    <QuoteDocPdf
      quote={{ number: 'RQ26003', title: 'T', date: '26/08/2026' }}
      company={company}
      doc={doc()}
      details={details}
      pricing={buildPricingModel(sections, totals, DEFAULT_PRICING)}
      acceptance={{ signerName: 'Dan', signedAtDisplay: '27 Aug 2026, 9:00 am', signatureUrl: null }}
      watermark="Issued to Malcolm Civil via the client portal"
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
})

test('templated quote without an acceptance block still prints portal evidence', async () => {
  const d = doc()
  d.blocks = d.blocks.filter((b) => b.type !== 'acceptance')
  const buffer = await renderToBuffer(
    <QuoteDocPdf
      quote={{ number: 'RQ26003', title: 'T', date: '26/08/2026' }}
      company={company}
      doc={d}
      details={details}
      pricing={buildPricingModel(sections, totals, DEFAULT_PRICING)}
      acceptance={{ signerName: 'Dan', signedAtDisplay: '27 Aug 2026, 9:00 am', signatureUrl: null }}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
})
