import { describe, expect, it } from 'vitest'
import {
  checkSwmsDocumentAttachment,
  isPdfFile,
  swmsDocumentCreateSchema,
  swmsDocumentReviseSchema,
  titleFromFilename,
} from '@/lib/swms-document'

const JOB = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ATT = '33333333-3333-4333-8333-333333333333'

describe('isPdfFile', () => {
  it('accepts application/pdf or a .pdf name', () => {
    expect(isPdfFile('application/pdf', 'x.bin')).toBe(true)
    expect(isPdfFile(null, 'SWMS-01.PDF')).toBe(true)
    expect(isPdfFile('image/png', 'photo.png')).toBe(false)
    expect(isPdfFile(undefined, 'swms.docx')).toBe(false)
  })
})

describe('titleFromFilename', () => {
  it('strips the extension and trims', () => {
    expect(titleFromFilename('RJ26001-SWMS-01 Safe Work Method Statement.pdf')).toBe(
      'RJ26001-SWMS-01 Safe Work Method Statement'
    )
    expect(titleFromFilename('  plain  ')).toBe('plain')
  })
})

describe('checkSwmsDocumentAttachment', () => {
  const parent = { type: 'job' as const, id: JOB }
  const pdf = { parent_type: 'job', parent_id: JOB, content_type: 'application/pdf', filename: 'a.pdf' }

  it('passes a PDF on the same parent', () => {
    expect(checkSwmsDocumentAttachment(pdf, parent)).toBeNull()
  })
  it('rejects a missing attachment', () => {
    expect(checkSwmsDocumentAttachment(null, parent)).toBe('That file no longer exists')
  })
  it('rejects a non-PDF', () => {
    expect(
      checkSwmsDocumentAttachment({ ...pdf, content_type: 'image/jpeg', filename: 'a.jpg' }, parent)
    ).toBe('The SWMS must be a PDF')
  })
  it('rejects a file from another job', () => {
    expect(checkSwmsDocumentAttachment({ ...pdf, parent_id: OTHER }, parent)).toBe(
      'That file belongs to a different job or project'
    )
    expect(checkSwmsDocumentAttachment({ ...pdf, parent_type: 'project' }, parent)).toBe(
      'That file belongs to a different job or project'
    )
  })
})

describe('swmsDocumentCreateSchema', () => {
  it('needs exactly one parent, a title and an attachment', () => {
    expect(
      swmsDocumentCreateSchema.safeParse({ title: 'SWMS', attachment_id: ATT, job_id: JOB }).success
    ).toBe(true)
    expect(
      swmsDocumentCreateSchema.safeParse({ title: 'SWMS', attachment_id: ATT }).success
    ).toBe(false)
    expect(
      swmsDocumentCreateSchema.safeParse({
        title: 'SWMS', attachment_id: ATT, job_id: JOB, project_id: OTHER,
      }).success
    ).toBe(false)
    const noTitle = swmsDocumentCreateSchema.safeParse({ title: '  ', attachment_id: ATT, job_id: JOB })
    expect(noTitle.success).toBe(false)
  })
})

describe('swmsDocumentReviseSchema', () => {
  it('needs the instance and the replacement file', () => {
    expect(swmsDocumentReviseSchema.safeParse({ instance_id: JOB, attachment_id: ATT }).success).toBe(true)
    expect(swmsDocumentReviseSchema.safeParse({ instance_id: JOB }).success).toBe(false)
  })
})
