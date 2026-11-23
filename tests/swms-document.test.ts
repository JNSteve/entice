import { describe, expect, it } from 'vitest'
import {
  checkSwmsDocumentAttachment,
  isPdfFile,
  replacedDocumentIds,
  swmsDocumentCreateSchema,
  swmsDocumentReviseSchema,
  swmsIssueState,
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

describe('swmsIssueState', () => {
  const pdf = { id: ATT, filename: 'RJ26038-SWMS-01 SWMS.pdf', content_type: 'application/pdf' }
  const active = { status: 'active', documentId: ATT }
  const superseded = { status: 'superseded', documentId: ATT }

  it('is not issued while no SWMS points at the file', () => {
    expect(swmsIssueState(pdf, [], [])).toBe('not_issued')
    // A SWMS built from a template, or one on another PDF, does not count.
    expect(
      swmsIssueState(pdf, [{ status: 'active', documentId: null }, { status: 'active', documentId: OTHER }], [])
    ).toBe('not_issued')
  })

  it('is issued once an active SWMS uses it, even beside a superseded one', () => {
    expect(swmsIssueState(pdf, [active], [])).toBe('issued')
    expect(swmsIssueState(pdf, [superseded, active], [])).toBe('issued')
  })

  it('is superseded when the only SWMS using it has been superseded', () => {
    expect(swmsIssueState(pdf, [superseded], [])).toBe('superseded')
  })

  it('is replaced when a revision moved its SWMS on to a newer PDF', () => {
    expect(swmsIssueState(pdf, [{ status: 'active', documentId: OTHER }], [ATT])).toBe('replaced')
  })

  it('a replaced file issued again is issued', () => {
    expect(swmsIssueState(pdf, [active], [ATT])).toBe('issued')
  })

  it('a file that is not a PDF cannot be issued', () => {
    expect(
      swmsIssueState({ id: ATT, filename: 'RJ26038-SWMS-01 SWMS.docx', content_type: 'application/msword' }, [], [])
    ).toBe('not_pdf')
  })
})

describe('replacedDocumentIds', () => {
  it('collects the old file from every audit row that switched the PDF', () => {
    expect(
      replacedDocumentIds([
        { changed: { version: { from: 1, to: 2 }, document_attachment_id: { from: ATT, to: OTHER } } },
        { changed: { version: { from: 2, to: 3 }, document_attachment_id: { from: OTHER, to: JOB } } },
        // The same file switched away twice is listed once.
        { changed: { document_attachment_id: { from: ATT, to: JOB } } },
      ])
    ).toEqual([ATT, OTHER])
  })

  it('ignores rows that did not switch the PDF, and anything malformed', () => {
    expect(
      replacedDocumentIds([
        { changed: { status: { from: 'active', to: 'superseded' } } },
        { title: 'SWMS', status: 'active' },
        { changed: { document_attachment_id: { from: null, to: ATT } } },
        { changed: { document_attachment_id: 'nope' } },
        null,
        'text',
      ])
    ).toEqual([])
  })
})
