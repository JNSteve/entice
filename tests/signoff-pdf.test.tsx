import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { DailySignoffPdf, type DailySignoffPdfLine } from '../src/pdf/DailySignoffPdf'

const company = {
  name: 'Entice Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW 2000',
  phone: '02 9000 0000',
  email: 'office@entice.example',
  logoUrl: undefined,
}

// 1×1 transparent PNG.
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const lines: DailySignoffPdfLine[] = [
  {
    id: 'l1',
    section: 'labour',
    description: 'Jo Smith',
    qty: 8.5,
    unit: 'hrs',
    detail: '07:00–15:30',
    scope_label: 'Stage 2 — removal',
    dispute: null,
  },
  {
    id: 'l2',
    section: 'subbie',
    description: 'Bridger Scaffolding',
    qty: 16,
    unit: 'hrs',
    detail: '2 × 8 hrs',
    scope_label: null,
    dispute: null,
  },
  {
    id: 'l3',
    section: 'plant',
    description: '5t excavator',
    qty: 6,
    unit: 'hrs',
    detail: null,
    scope_label: null,
    dispute: null,
  },
  {
    id: 'l4',
    section: 'material',
    description: 'Road base',
    qty: 12.25,
    unit: 't',
    detail: null,
    scope_label: null,
    dispute: null,
  },
]

const sheet = {
  workNumber: 'J-0042',
  workTitle: 'Asbestos removal — Shed 3',
  clientName: 'Acme Holdings',
  siteName: '12 Example Rd',
  day: 'Thursday 01/10/2026',
  version: 1,
  releasedAt: '01/10/2026',
  summary: 'Removed bonded sheeting from the east wall; site cleaned and bagged.',
}

function expectPdf(buffer: Buffer) {
  expect(Buffer.isBuffer(buffer)).toBe(true)
  expect(buffer.length).toBeGreaterThan(1000)
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
}

test('daily sign-off pdf renders a signed sheet without disputes', async () => {
  const buffer = await renderToBuffer(
    <DailySignoffPdf
      sheet={{ ...sheet, status: 'signed' }}
      company={company}
      lines={lines}
      photos={[]}
      response={{
        signerName: 'Pat Client',
        signedAt: '01/10/2026 16:40',
        signatureData: SIGNATURE,
        ip: '203.0.113.7',
        disputeCount: 0,
      }}
    />
  )
  expectPdf(buffer)
})

test('daily sign-off pdf renders a disputed revision with client figures', async () => {
  const disputed = lines.map((l) =>
    l.id === 'l3' ? { ...l, dispute: { client_qty: 4, reason: 'Excavator idle after lunch' } } : l
  )
  const buffer = await renderToBuffer(
    <DailySignoffPdf
      sheet={{ ...sheet, version: 2, status: 'disputed' }}
      company={company}
      lines={disputed}
      photos={[]}
      response={{
        signerName: 'Pat Client',
        signedAt: '01/10/2026 16:40',
        signatureData: SIGNATURE,
        ip: null,
        disputeCount: 1,
      }}
      watermark="Issued to Acme Holdings — 01/10/2026"
    />
  )
  expectPdf(buffer)
})
