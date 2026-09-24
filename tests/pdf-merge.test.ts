import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { appendPdf, checkOriginalPdf } from '@/lib/pdf-merge'

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  return doc.save()
}

async function makeEncryptedLookingPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage()
  // Mark the trailer as encrypted — pdf-lib refuses to load such files
  // without ignoreEncryption, exactly like a real password-protected PDF.
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of('Standard') })
  return doc.save()
}

describe('checkOriginalPdf', () => {
  it('accepts a normal PDF', async () => {
    expect(await checkOriginalPdf(await makePdf(2))).toEqual({ ok: true })
  })

  it('reports a missing file', async () => {
    expect(await checkOriginalPdf(null)).toEqual({
      ok: false,
      reason: 'the file is missing from storage',
    })
  })

  it('reports garbage bytes as unreadable', async () => {
    const res = await checkOriginalPdf(new TextEncoder().encode('not a pdf at all'))
    expect(res).toEqual({ ok: false, reason: 'the PDF could not be read' })
  })

  it('reports an encrypted PDF as password-protected', async () => {
    const res = await checkOriginalPdf(await makeEncryptedLookingPdf())
    expect(res).toEqual({ ok: false, reason: 'the PDF is password-protected' })
  })
})

describe('appendPdf', () => {
  it('puts original pages first, then the appendix pages', async () => {
    const original = await PDFDocument.create()
    original.addPage([100, 100])
    original.addPage([100, 100])
    const appendix = await PDFDocument.create()
    appendix.addPage([200, 300])

    const merged = await PDFDocument.load(
      await appendPdf(await original.save(), await appendix.save())
    )
    expect(merged.getPageCount()).toBe(3)
    expect(merged.getPage(0).getSize()).toEqual({ width: 100, height: 100 })
    expect(merged.getPage(2).getSize()).toEqual({ width: 200, height: 300 })
  })
})
