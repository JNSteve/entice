import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { SwmsPdf } from '../src/pdf/SwmsPdf'
import { SwmsRegisterPdf } from '../src/pdf/SwmsRegisterPdf'

const company = {
  name: 'Test Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW',
  phone: '02 9000 0000',
  email: 'office@test.example',
  logoUrl: undefined,
}

const swms = {
  title: 'Demolition SWMS',
  parentLabel: 'RJ26001 — Shed removal',
  version: 2,
  status: 'active',
  date: '10/10/2026',
}

const signatures = [
  {
    name: 'Sam Worker',
    role: 'Field',
    company: 'Test Civil Pty Ltd',
    date: '11/10/2026',
    version: 2,
    imageUrl: null,
  },
]

const changes = [{ date: '10/10/2026', description: 'Issued (v1)', by: 'Office' }]

const base = {
  swms,
  company,
  docControl: [],
  scopeNote: '',
  projectDetails: [],
  hrcw: [],
  requirements: [],
  steps: [
    {
      step: 'Isolate services',
      hazards: 'Electric shock',
      initial_risk: 'H',
      controls: 'Lock out and tag',
      residual_risk: 'L',
      responsible: 'Supervisor',
    },
  ],
  stopWorkTriggers: [],
  emergencyContacts: [],
  emergencyScenarios: [],
  referencesList: [],
  signatures,
  earlierSignatureCount: 0,
  changes,
}

const WATERMARK = 'Issued to Damon Constructions via the client portal — 16/10/2026'

test('SWMS pdf renders without the sign-on register and with a watermark', async () => {
  const buffer = await renderToBuffer(
    <SwmsPdf {...base} showSignatures={false} watermark={WATERMARK} />
  )
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})

test('SWMS pdf still renders the register by default', async () => {
  const buffer = await renderToBuffer(<SwmsPdf {...base} />)
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})

test('register pdf accepts a watermark', async () => {
  const buffer = await renderToBuffer(
    <SwmsRegisterPdf
      swms={swms}
      company={company}
      sourceFilename="Demolition SWMS.pdf"
      generatedAt="16/10/2026 09:00"
      signatures={signatures}
      earlierSignatureCount={0}
      changes={changes}
      originalProblem={null}
      watermark={WATERMARK}
    />
  )
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})
