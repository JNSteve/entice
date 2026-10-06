/**
 * Per-job records required by the certified ECR IMS Rev 1 (SMS-02 Rev 2,
 * IMS-03/05 Rev 2, SMS-10/13 Rev 2). A job needs only the records in its row:
 * every job has the signed quote, a RA or SWMS, the one-page hold point
 * checklist, a signed prestart and photos; jobs over one day add the plan,
 * start-up, induction, weekly inspection and handover; licensed asbestos
 * removal adds the ARCP and clearance certificate (and the daily log on Class A
 * or multi-day work). Nothing here gates anything — it lists what to file and
 * shows what is already filed.
 *
 * Naming (SMS-02): controlled job documents are `<job>-<CODE>-<seq>`
 * (RJ26013-SWMS-01); dated records keep their date in the name
 * (`RJ26013 Prestart 2026-09-25`). Filed within seven days of the last shift
 * (CAR-2026-06).
 */

export type LicensedRemoval = 'none' | 'class_a' | 'class_b'

export type JobRecordsProfile = {
  licensed: LicensedRemoval
  multiDay: boolean
  regulatedWaste: boolean
}

export const JOB_FOLDERS = {
  1: '1 Quote',
  2: '2 Supplied information',
  3: '3 Plan and hold points',
  4: '4 Health and safety',
  5: '5 Reports',
  6: '6 Records',
} as const
export type JobFolder = keyof typeof JOB_FOLDERS

export type JobRecordSlot = {
  key: string
  label: string
  /** The IMS form or template the record is made on. */
  form: string
  folder: JobFolder
  /**
   * 'coded'    → named <job>-<CODE>-<seq>; codes[0] is the default
   * 'dated'    → named <job> <label> <date>
   * 'photo'    → any photo attachment on the job
   * 'register' → a register row, not a file (shown as a reminder only)
   */
  naming: 'coded' | 'dated' | 'photo' | 'register'
  codes?: string[]
  /** Matches an existing dated record by filename or caption. */
  match?: RegExp
  note?: string
}

const QUOTE: JobRecordSlot = {
  key: 'quote', label: 'Signed quote', form: 'Quote module (contract review record, IMS-03)',
  folder: 1, naming: 'coded', codes: ['QTE'],
}
const RA_OR_SWMS: JobRecordSlot = {
  key: 'ra_swms', label: 'Risk assessment or SWMS', form: 'SMS-F-02 / SWMS master template',
  folder: 4, naming: 'coded', codes: ['RA', 'SWMS'],
  note: 'SWMS where the work is high-risk construction work',
}
const SWMS: JobRecordSlot = {
  key: 'swms', label: 'SWMS', form: 'SWMS master template', folder: 4, naming: 'coded', codes: ['SWMS'],
}
const ARCP: JobRecordSlot = {
  key: 'arcp', label: 'Asbestos removal control plan', form: 'SMS-F-23', folder: 4, naming: 'coded', codes: ['ARCP'],
}
const ITP: JobRecordSlot = {
  key: 'itp', label: 'Job hold point checklist', form: 'IMS-F-02 Rev 2', folder: 3, naming: 'coded', codes: ['ITP'],
}
const PRESTART: JobRecordSlot = {
  key: 'prestart', label: 'Prestart', form: 'SMS-F-11 (two-page site format, signed)', folder: 4, naming: 'dated',
  match: /pre-?start/i,
}
const PLAN: JobRecordSlot = {
  key: 'plan', label: 'Project plan', form: 'SMS-F-22 + IMS-F-06', folder: 3, naming: 'coded', codes: ['PLN'],
}
const START_UP: JobRecordSlot = {
  key: 'start_up', label: 'Start-up checklist', form: 'SMS-F-25', folder: 3, naming: 'dated', match: /start-?up/i,
}
const INDUCTION: JobRecordSlot = {
  key: 'induction', label: 'Site induction', form: 'SMS-F-16 Rev 2', folder: 4, naming: 'dated', match: /induction/i,
}
const INSPECTION: JobRecordSlot = {
  key: 'inspection', label: 'Site inspection', form: 'SMS-F-06 (weekly)', folder: 4, naming: 'dated',
  match: /site inspection|SMS-F-06/i,
}
const DAILY_LOG: JobRecordSlot = {
  key: 'daily_log', label: 'Daily log', form: 'SMS-F-24', folder: 4, naming: 'dated', match: /daily log|SMS-F-24/i,
}
const HANDOVER: JobRecordSlot = {
  key: 'handover', label: 'Handover checklist', form: 'IMS-F-03 Rev 1 (with Part B close-out)', folder: 3,
  naming: 'coded', codes: ['HO'],
}
const WASTE: JobRecordSlot = {
  key: 'waste', label: 'Waste certificate and facility receipt', form: 'Transport certificate + IMS-R-02 row',
  folder: 6, naming: 'dated', match: /waste|docket/i,
}
const CLEARANCE: JobRecordSlot = {
  key: 'clearance', label: 'Clearance certificate', form: 'From the independent assessor, before release',
  folder: 5, naming: 'dated', match: /clearance/i,
}
const PHOTOS: JobRecordSlot = {
  key: 'photos', label: 'Photos before, during and after', form: 'Job photos', folder: 6, naming: 'photo',
}
const COMPLETION_REVIEW: JobRecordSlot = {
  key: 'completion_review', label: 'Client completion review', form: 'A row in IMS-R-04 (IMS-F-04 optional)',
  folder: 6, naming: 'register',
}

/** The records this job must hold, in filing order. */
export function requiredJobRecords(p: JobRecordsProfile): JobRecordSlot[] {
  const licensed = p.licensed !== 'none'
  const slots: JobRecordSlot[] = [QUOTE]
  if (licensed) slots.push(SWMS, ARCP)
  else slots.push(RA_OR_SWMS)
  slots.push(
    licensed ? { ...ITP, note: 'Line 3: ARCP copy to the person who commissioned the work' } : ITP,
    p.multiDay
      ? { ...PRESTART, note: 'One per day' }
      : { ...PRESTART, note: 'On a one-day job this is also the induction, daily log and site inspection' }
  )
  if (p.multiDay) slots.push(PLAN, START_UP, INDUCTION, INSPECTION)
  if (licensed && (p.licensed === 'class_a' || p.multiDay)) slots.push(DAILY_LOG)
  if (p.multiDay) slots.push(HANDOVER)
  if (licensed || p.regulatedWaste) slots.push(WASTE)
  if (licensed) slots.push(CLEARANCE)
  slots.push(PHOTOS, COMPLETION_REVIEW)
  return slots
}

/** A job runs over one day when its scheduled end falls after its start. */
export function isMultiDay(start: string | null, end: string | null): boolean {
  return !!start && !!end && end > start
}

export type JobFile = { filename: string | null; caption: string | null; kind: string | null }

function codedPrefix(jobNumber: string, code: string) {
  return `${jobNumber}-${code}-`.toUpperCase()
}

/** The job's files that satisfy a slot. Register slots never match a file. */
export function filesForSlot(jobNumber: string, slot: JobRecordSlot, files: JobFile[]): JobFile[] {
  switch (slot.naming) {
    case 'photo':
      return files.filter((f) => f.kind === 'photo')
    case 'register':
      return []
    case 'coded':
      return files.filter((f) => {
        const name = (f.filename ?? '').toUpperCase()
        return (slot.codes ?? []).some((c) => name.startsWith(codedPrefix(jobNumber, c)))
      })
    case 'dated':
      return files.filter((f) => f.kind !== 'photo' && slot.match!.test(`${f.filename ?? ''} ${f.caption ?? ''}`))
  }
}

/** Next two-digit sequence for a coded record (RJ26013-SWMS-02 after -01). */
export function nextRecordSeq(jobNumber: string, code: string, filenames: (string | null)[]): string {
  const prefix = codedPrefix(jobNumber, code)
  let max = 0
  for (const f of filenames) {
    const name = (f ?? '').toUpperCase()
    if (!name.startsWith(prefix)) continue
    const n = parseInt(name.slice(prefix.length, prefix.length + 2), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1).padStart(2, '0')
}

/** Characters Windows and storage keys both reject. */
function clean(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The SMS-02 filename for a record being filed against a slot. `ext` is taken
 * from the uploaded file and includes no dot.
 */
export function recordFileName(
  jobNumber: string,
  slot: JobRecordSlot,
  opts: { ext: string; code?: string; seq?: string; date?: string; title?: string }
): string {
  const ext = opts.ext ? `.${opts.ext.toLowerCase()}` : ''
  if (slot.naming === 'coded') {
    const code = opts.code ?? slot.codes![0]
    const title = clean(opts.title ?? slot.label)
    return `${jobNumber}-${code}-${opts.seq ?? '01'} ${title}${ext}`
  }
  const title = clean(opts.title ?? slot.label)
  return `${jobNumber} ${title}${opts.date ? ` ${opts.date}` : ''}${ext}`
}

/**
 * The last shift on site: the scheduled end; for a one-day job with no end
 * set, its start; else the Brisbane day the job was completed (`completedOn`,
 * worked out by the caller so this module stays free of server time helpers).
 */
export function lastShiftOnSite(
  scheduledStart: string | null,
  scheduledEnd: string | null,
  completedOn: string | null
): string | null {
  return scheduledEnd ?? scheduledStart ?? completedOn
}

/** Filing is due seven days after the last shift on site (SMS-02, CAR-2026-06). */
export const FILING_DAYS = 7

export function filingDueDate(lastShift: string): string {
  const d = new Date(`${lastShift}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + FILING_DAYS)
  return d.toISOString().slice(0, 10)
}

export type SlotStatus = { slot: JobRecordSlot; files: JobFile[]; filed: boolean }

export function jobRecordStatus(jobNumber: string, profile: JobRecordsProfile, files: JobFile[]): SlotStatus[] {
  return requiredJobRecords(profile).map((slot) => {
    const matched = filesForSlot(jobNumber, slot, files)
    return { slot, files: matched, filed: matched.length > 0 }
  })
}

/** Slots still to file — register rows are excluded (they live in IMS-R-04, not on the job). */
export function missingRecords(statuses: SlotStatus[]): JobRecordSlot[] {
  return statuses.filter((s) => !s.filed && s.slot.naming !== 'register').map((s) => s.slot)
}
