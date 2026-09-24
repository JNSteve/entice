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
