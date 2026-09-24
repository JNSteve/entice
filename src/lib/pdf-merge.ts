import { PDFDocument } from 'pdf-lib'

export type OriginalPdfCheck =
  | { ok: true; doc: PDFDocument }
  | { ok: false; reason: string }

/**
 * Can this uploaded PDF be merged into a signed copy? On success returns the
 * loaded document for appendPdf. The reason strings are printed on the
 * register page when the original can't be attached.
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
    return { ok: true, doc }
  } catch {
    return { ok: false, reason: 'the PDF could not be read' }
  }
}

/**
 * Original pages first, then every appendix page. Mutates `original`. May
 * throw on damaged files that loaded leniently — callers must fall back.
 */
export async function appendPdf(
  original: PDFDocument,
  appendixBytes: Uint8Array
): Promise<Uint8Array> {
  const appendix = await PDFDocument.load(appendixBytes)
  const pages = await original.copyPages(appendix, appendix.getPageIndices())
  for (const page of pages) original.addPage(page)
  return original.save()
}
