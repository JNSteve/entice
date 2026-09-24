import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { SwmsRegisterPdf } from '../src/pdf/SwmsRegisterPdf'

const company = {
  name: 'Test Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW',
  phone: '02 9000 0000',
  email: 'office@test.example',
  logoUrl: undefined,
}

const base = {
  swms: {
    title: 'RJ26001-SWMS-01',
    parentLabel: 'J-0042 — Asbestos removal',
    version: 2,
    status: 'active',
    date: '24/09/2026',
  },
  company,
  sourceFilename: 'RJ26001-SWMS-01 Safe Work Method Statement.pdf',
  generatedAt: '24/09/2026 10:15',
  signatures: [
    { name: 'Sam Worker', role: 'Field', company: 'Test Civil Pty Ltd', date: '24/09/2026', version: 2, imageUrl: null },
    { name: 'Ext Sub', role: 'External', company: 'Sub Co', date: '24/09/2026', version: 2, imageUrl: null },
  ],
  earlierSignatureCount: 3,
  changes: [{ date: '20/09/2026', description: 'Issued (v1)', by: 'Office' }],
}

test('register pdf renders with signatures', async () => {
  const buffer = await renderToBuffer(<SwmsRegisterPdf {...base} originalProblem={null} />)
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})

test('register pdf renders the fallback note when the original is unusable', async () => {
  const buffer = await renderToBuffer(
    <SwmsRegisterPdf {...base} signatures={[]} originalProblem="the PDF is password-protected" />
  )
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})
