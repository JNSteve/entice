import { z } from 'zod'

/**
 * Document-backed SWMS: an uploaded PDF (an attachments row) issued as a
 * swms_instance so workers can sign on to it. See migration 0064.
 */

const optionalUuid = z
  .uuid()
  .nullish()
  .transform((v) => v ?? null)

export const swmsDocumentCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
    attachment_id: z.uuid('Pick or upload the SWMS PDF'),
    project_id: optionalUuid,
    job_id: optionalUuid,
  })
  .refine(
    (d) => (d.project_id === null) !== (d.job_id === null),
    'Attach the SWMS to one project or job'
  )
export type SwmsDocumentCreateInput = z.infer<typeof swmsDocumentCreateSchema>

export const swmsDocumentReviseSchema = z.object({
  instance_id: z.uuid(),
  attachment_id: z.uuid('Pick or upload the revised PDF'),
})
export type SwmsDocumentReviseInput = z.infer<typeof swmsDocumentReviseSchema>

export function isPdfFile(contentType: string | null | undefined, filename: string): boolean {
  return contentType === 'application/pdf' || /\.pdf$/i.test(filename.trim())
}

export function titleFromFilename(filename: string): string {
  return filename.trim().replace(/\.[a-z0-9]+$/i, '').trim()
}

export type SwmsDocumentAttachment = {
  parent_type: string
  parent_id: string
  content_type: string | null
  filename: string
}

/** Error message, or null when the attachment can back a SWMS on this parent. */
export function checkSwmsDocumentAttachment(
  att: SwmsDocumentAttachment | null,
  parent: { type: 'job' | 'project'; id: string }
): string | null {
  if (!att) return 'That file no longer exists'
  if (att.parent_type !== parent.type || att.parent_id !== parent.id) {
    return 'That file belongs to a different job or project'
  }
  if (!isPdfFile(att.content_type, att.filename)) return 'The SWMS must be a PDF'
  return null
}

/**
 * Where an uploaded SWMS PDF stands with the crew:
 *   issued      an active SWMS uses it — the crew see it and sign on
 *   superseded  the only SWMS that used it has been superseded
 *   replaced    a revision moved its SWMS on to a newer PDF
 *   not_pdf     only a PDF can be issued for sign-on
 *   not_issued  filed, but the crew cannot see it yet
 */
export type SwmsIssueState = 'issued' | 'superseded' | 'replaced' | 'not_pdf' | 'not_issued'

export function swmsIssueState(
  file: { id: string; filename: string; content_type: string | null },
  instances: { status: string; documentId: string | null }[],
  replacedIds: readonly string[]
): SwmsIssueState {
  const using = instances.filter((i) => i.documentId === file.id)
  if (using.some((i) => i.status === 'active')) return 'issued'
  if (using.length > 0) return 'superseded'
  if (replacedIds.includes(file.id)) return 'replaced'
  if (!isPdfFile(file.content_type, file.filename)) return 'not_pdf'
  return 'not_issued'
}

/**
 * The PDFs a document-backed SWMS used before it was revised, read from the
 * audit trail: audit_whs() (migration 0010) logs every swms_instances update
 * as `{ changed: { <column>: { from, to } } }`, so a revision shows as a
 * document_attachment_id change. Takes the audit rows' `detail` values.
 */
export function replacedDocumentIds(details: unknown[]): string[] {
  const ids = new Set<string>()
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const changed = (detail as { changed?: unknown }).changed
    if (!changed || typeof changed !== 'object') continue
    const change = (changed as { document_attachment_id?: unknown }).document_attachment_id
    if (!change || typeof change !== 'object') continue
    const from = (change as { from?: unknown }).from
    if (typeof from === 'string' && from) ids.add(from)
  }
  return [...ids]
}
