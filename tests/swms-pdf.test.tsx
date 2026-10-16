import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { SwmsPdf, type SwmsPdfProps } from '../src/pdf/SwmsPdf'

const base: SwmsPdfProps = {
  swms: {
    title: 'Asbestos removal — non-friable',
    parentLabel: 'J-0042 — Asbestos removal',
    version: 1,
    status: 'active',
    date: '02/10/2026',
  },
  company: {
    name: 'Test Civil Pty Ltd',
    abn: '11 222 333 444',
    address: '1 Test St, Sydney NSW',
    phone: '02 9000 0000',
    email: 'office@test.example',
    logoUrl: undefined,
  },
  docControl: [{ label: 'Prepared by', value: 'Office' }],
  scopeNote: '',
  projectDetails: [],
  hrcw: [],
  requirements: [],
  steps: [],
  stopWorkTriggers: [],
  emergencyContacts: [],
  emergencyScenarios: [],
  referencesList: [],
  signatures: [],
  earlierSignatureCount: 0,
  changes: [],
}

async function pageCount(props: SwmsPdfProps) {
  const buffer = await renderToBuffer(<SwmsPdf {...props} />)
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  return (buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
}

test('swms pdf without a title page has no cover', async () => {
  expect(await pageCount(base)).toBe(1)
})

test('swms pdf with a title page adds a cover page', async () => {
  expect(
    await pageCount({
      ...base,
      titlePage: [
        { label: 'Client', value: 'Acme Builders' },
        { label: 'Site address', value: '12 Site St, Burleigh Heads QLD 4220' },
      ],
    })
  ).toBe(2)
})
