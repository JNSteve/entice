import { describe, expect, it } from 'vitest'
import {
  filesForSlot,
  filingDueDate,
  isMultiDay,
  jobRecordStatus,
  lastShiftOnSite,
  missingRecords,
  nextRecordSeq,
  recordFileName,
  requiredJobRecords,
  type JobFile,
} from '@/lib/job-records'

const keys = (p: Parameters<typeof requiredJobRecords>[0]) => requiredJobRecords(p).map((s) => s.key)

describe('requiredJobRecords (brief section 3 table)', () => {
  it('one-day, unlicensed, no regulated waste: the five-record minimum', () => {
    expect(keys({ licensed: 'none', multiDay: false, regulatedWaste: false })).toEqual([
      'quote', 'ra_swms', 'itp', 'prestart', 'photos', 'completion_review',
    ])
  })

  it('job over one day adds plan, start-up, induction, inspection and handover', () => {
    expect(keys({ licensed: 'none', multiDay: true, regulatedWaste: false })).toEqual([
      'quote', 'ra_swms', 'itp', 'prestart', 'plan', 'start_up', 'induction', 'inspection', 'handover',
      'photos', 'completion_review',
    ])
  })

  it('one-day Class B removal (RJ26013): SWMS + ARCP, waste, clearance, no daily log', () => {
    expect(keys({ licensed: 'class_b', multiDay: false, regulatedWaste: false })).toEqual([
      'quote', 'swms', 'arcp', 'itp', 'prestart', 'waste', 'clearance', 'photos', 'completion_review',
    ])
  })

  it('Class A needs the daily log even on one day', () => {
    expect(keys({ licensed: 'class_a', multiDay: false, regulatedWaste: false })).toContain('daily_log')
  })

  it('multi-day Class B needs the daily log', () => {
    expect(keys({ licensed: 'class_b', multiDay: true, regulatedWaste: false })).toContain('daily_log')
  })

  it('regulated waste on an unlicensed job adds the waste record only', () => {
    const k = keys({ licensed: 'none', multiDay: false, regulatedWaste: true })
    expect(k).toContain('waste')
    expect(k).not.toContain('clearance')
  })

  it('the licensed hold point checklist carries the ARCP-to-client line', () => {
    const itp = requiredJobRecords({ licensed: 'class_b', multiDay: false, regulatedWaste: false }).find((s) => s.key === 'itp')
    expect(itp?.note).toMatch(/ARCP copy/)
  })
})

describe('isMultiDay', () => {
  it('needs both dates and an end after the start', () => {
    expect(isMultiDay('2026-09-24', '2026-09-25')).toBe(true)
    expect(isMultiDay('2026-10-06', '2026-10-06')).toBe(false)
    expect(isMultiDay(null, '2026-10-06')).toBe(false)
  })
})

// The RJ26013 folder as filed for the Stage 2 audit.
const RJ26013: JobFile[] = [
  { filename: 'RJ26013-QTE-01 Quote RQ26013 signed by client 2026-09-16.pdf', caption: null, kind: 'document' },
  { filename: 'RJ26013-ITP-01 Inspection and Test Plan.pdf', caption: null, kind: 'document' },
  { filename: 'RJ26013 Prestart 2026-09-25 page 1.jpg', caption: null, kind: 'document' },
  { filename: 'RJ26013-ARCP-01 Asbestos Removal Control Plan.pdf', caption: null, kind: 'document' },
  { filename: 'RJ26013-SWMS-01 Safe Work Method Statement Rev 1.pdf', caption: null, kind: 'document' },
  { filename: 'RJ26013 Hazmat Plus clearance certificate H26101-CLR-01 inspection 2026-09-25 issued 2026-09-27.pdf', caption: null, kind: 'document' },
  { filename: 'RJ26013 Waste transport certificate Q02511349 and BMI Stapylton receipt 2026-09-25.jpg', caption: null, kind: 'document' },
  { filename: 'IMG_0001.jpg', caption: null, kind: 'photo' },
]

describe('filing status', () => {
  it('RJ26013 as filed has every required record', () => {
    const s = jobRecordStatus('RJ26013', { licensed: 'class_b', multiDay: false, regulatedWaste: false }, RJ26013)
    expect(missingRecords(s)).toEqual([])
  })

  it('a clearance certificate that mentions "inspection" does not count as a site inspection', () => {
    const slot = requiredJobRecords({ licensed: 'class_b', multiDay: true, regulatedWaste: false }).find((s) => s.key === 'inspection')!
    expect(filesForSlot('RJ26013', slot, RJ26013)).toEqual([])
  })

  it('coded matching is per job and case-insensitive', () => {
    const slot = requiredJobRecords({ licensed: 'none', multiDay: false, regulatedWaste: false }).find((s) => s.key === 'ra_swms')!
    expect(filesForSlot('RJ26001', slot, [{ filename: 'rj26001-ra-01 risk assessment.docx', caption: null, kind: 'document' }])).toHaveLength(1)
    expect(filesForSlot('RJ26001', slot, [{ filename: 'RJ26013-RA-01 Risk Assessment.pdf', caption: null, kind: 'document' }])).toHaveLength(0)
  })

  it('missing records never include the IMS-R-04 register row', () => {
    const s = jobRecordStatus('RJ26099', { licensed: 'none', multiDay: false, regulatedWaste: false }, [])
    expect(missingRecords(s).map((x) => x.key)).toEqual(['quote', 'ra_swms', 'itp', 'prestart', 'photos'])
  })
})

describe('naming', () => {
  it('next sequence follows the highest filed number for that code', () => {
    expect(nextRecordSeq('RJ26013', 'SWMS', ['RJ26013-SWMS-01 x.pdf', 'RJ26013-SWMS-03 y.pdf', 'RJ26013-RA-05 z.pdf'])).toBe('04')
    expect(nextRecordSeq('RJ26013', 'ARCP', [])).toBe('01')
  })

  it('coded and dated names match the job folder convention', () => {
    const slots = requiredJobRecords({ licensed: 'class_b', multiDay: false, regulatedWaste: false })
    const swms = slots.find((s) => s.key === 'swms')!
    const prestart = slots.find((s) => s.key === 'prestart')!
    expect(recordFileName('RJ26013', swms, { ext: 'PDF', seq: '01', title: 'Safe Work Method Statement' }))
      .toBe('RJ26013-SWMS-01 Safe Work Method Statement.pdf')
    expect(recordFileName('RJ26013', prestart, { ext: 'jpg', date: '2026-09-25' })).toBe('RJ26013 Prestart 2026-09-25.jpg')
  })

  it('strips characters a filename cannot hold', () => {
    const qte = requiredJobRecords({ licensed: 'none', multiDay: false, regulatedWaste: false })[0]
    expect(recordFileName('RJ26018', qte, { ext: 'pdf', title: 'Quote: signed / client' })).toBe('RJ26018-QTE-01 Quote signed client.pdf')
  })
})

describe('filingDueDate', () => {
  it('is seven days after the last shift', () => {
    expect(filingDueDate('2026-09-25')).toBe('2026-10-02')
    expect(filingDueDate('2026-12-28')).toBe('2027-01-04')
  })
})

describe('lastShiftOnSite', () => {
  it('is the scheduled end, else the start of a one-day job, else the completion day', () => {
    expect(lastShiftOnSite('2026-09-24', '2026-09-25', '2026-09-27')).toBe('2026-09-25')
    expect(lastShiftOnSite('2026-10-06', null, null)).toBe('2026-10-06')
    expect(lastShiftOnSite(null, null, '2026-09-21')).toBe('2026-09-21')
    expect(lastShiftOnSite(null, null, null)).toBeNull()
  })
})
