import { PDFDocument } from 'pdf-lib'

export type OriginalPdfCheck = { ok: true } | { ok: false; reason: string }

/**
 * Can this uploaded PDF be merged into a signed copy? The reason strings are
 * printed on the register page when the original can't be attached.
 */
export async function checkOriginalPdf(
  bytes: Uint8Array | null
): Promise<OriginalPdfCheck> {
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, reason: 'the file is missing from storage' }
  }
  try {
    // pdf-lib's EncryptedPDFError is transpiled to a plain Error (instanceof
    // fails), so load leniently and read the isEncrypted flag instead.
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    if (doc.isEncrypted) return { ok: false, reason: 'the PDF is password-protected' }
    if (doc.getPageCount() === 0) return { ok: false, reason: 'the PDF has no pages' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'the PDF could not be read' }
  }
}

/** Original pages first, then every appendix page. Call checkOriginalPdf first. */
export async function appendPdf(
  originalBytes: Uint8Array,
  appendixBytes: Uint8Array
): Promise<Uint8Array> {
  const merged = await PDFDocument.load(originalBytes)
  const appendix = await PDFDocument.load(appendixBytes)
  const pages = await merged.copyPages(appendix, appendix.getPageIndices())
  for (const page of pages) merged.addPage(page)
  return merged.save()
}
