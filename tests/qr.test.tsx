import { expect, test } from 'vitest'
import QRCode from 'qrcode'
import { renderToBuffer } from '@react-pdf/renderer'
import { QrPosterPdf } from '../src/pdf/QrPosterPdf'

const company = {
  name: 'Entice Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW 2000',
  phone: '02 9000 0000',
  email: 'office@entice.example',
  logoUrl: undefined,
}

test('qrcode produces a PNG data URL for a sign-on URL', async () => {
  const url = 'http://localhost:3000/sign/AbC123xyz_-token'
  const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 })

  expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  // A 600px QR is a real image, not a stub.
  expect(dataUrl.length).toBeGreaterThan(1000)
})

test('qr poster pdf renders (%PDF magic, non-trivial size)', async () => {
  const url = 'http://localhost:3000/sign/AbC123xyz_-token'
  const qrDataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 })

  const buffer = await renderToBuffer(
    <QrPosterPdf
      company={company}
      label="Excavation SWMS — site sign-on"
      projectName="P-0001 — Riverbank Stabilisation Stage 2"
      qrDataUrl={qrDataUrl}
      url={url}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})
