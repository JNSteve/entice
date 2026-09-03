// Client portal CP2a pure logic — document-library folder classification,
// calendar month bucketing and the portfolio dashboard summary. NO Supabase
// imports: these run in the anonymous portal pages and vitest alike.
// Date handling follows the house convention: 'YYYY-MM-DD' string compares
// against the Australian (Brisbane) calendar day (src/lib/tz.ts / portal.ts).

import { addDaysISO } from '@/lib/compliance'
import {
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PortalPropertyStatus,
  type PropertyComplianceKind,
} from '@/lib/portal'

// ─── Document library folders ────────────────────────────────────────────────

export type PortalFolder = 'compliance' | 'certificates' | 'works' | 'reports'

export const PORTAL_FOLDER_ORDER: PortalFolder[] = [
  'compliance',
  'certificates',
  'works',
  'reports',
]

export const PORTAL_FOLDER_LABELS: Record<PortalFolder, string> = {
  compliance: 'Compliance',
  certificates: 'Certificates',
  works: 'Works records',
  reports: 'Reports',
}

export const PORTAL_FOLDER_DESCRIPTIONS: Record<PortalFolder, string> = {
  compliance: 'Registers, management plans and surveys',
  certificates: 'Clearance certificates and air monitoring',
  works: 'Photos and documents from works',
  reports: 'Other reports and documents',
}

/**
 * Which folder a compliance item's document belongs to. Works records come
 * from job/project attachments, never from compliance items — hence the
 * Exclude on the return type.
 */
export function folderForItemKind(
  kind: PropertyComplianceKind
): Exclude<PortalFolder, 'works'> {
  switch (kind) {
    case 'clearance_certificate':
    case 'air_monitoring':
      return 'certificates'
    case 'other':
      return 'reports'
    default:
      // asbestos_register / asbestos_mgmt_plan / hazmat_survey / contaminated_land
      return 'compliance'
  }
}

// ─── File-type icons ─────────────────────────────────────────────────────────

export type PortalFileType = 'pdf' | 'image' | 'sheet' | 'doc' | 'other'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg', 'bmp']
const SHEET_EXTS = ['xls', 'xlsx', 'xlsm', 'csv']
const DOC_EXTS = ['doc', 'docx', 'rtf', 'txt']

/** Best-effort file type from content type first, filename extension second. */
export function fileTypeOf(
  filename: string | null | undefined,
  contentType?: string | null
): PortalFileType {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.startsWith('image/')) return 'image'
  if (ct === 'application/pdf') return 'pdf'
  if (ct.includes('spreadsheet') || ct.includes('excel') || ct === 'text/csv') {
    return 'sheet'
  }
  if (ct.includes('word')) return 'doc'

  const ext = (filename ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (SHEET_EXTS.includes(ext)) return 'sheet'
  if (DOC_EXTS.includes(ext)) return 'doc'
  return 'other'
}

/** '12.1 MB' / '340 KB' / '512 B'; '' for unknown sizes. */
export function fmtBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Document entries (folder browser rows) ──────────────────────────────────

export interface PortalDocEntry {
  id: string
  folder: PortalFolder
  /** Display name — filename when known, else the item/work title. */
  name: string
  /** Context line: compliance kind label, or work number + title. */
  sublabel: string
  /** 'YYYY-MM-DD' Brisbane date used for sorting and year grouping. */
  date: string | null
  size: number | null
  fileType: PortalFileType
  href: string
}

export interface PortalYearGroup {
  /** null = single ungrouped list (8 or fewer entries). */
  year: string | null
  entries: PortalDocEntry[]
}

/** Newest-first sort; undated entries sink to the bottom. */
export function sortEntries(entries: PortalDocEntry[]): PortalDocEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date === b.date) return a.name.localeCompare(b.name)
    if (a.date === null) return 1
    if (b.date === null) return -1
    return b.date < a.date ? -1 : 1
  })
}

/**
 * Year grouping for folder contents: 8 or fewer entries render as one flat
 * list (year: null); more get grouped by calendar year, newest year first,
 * undated entries last under 'Undated'.
 */
export function groupEntriesByYear(
  entries: PortalDocEntry[],
  threshold = 8
): PortalYearGroup[] {
  const sorted = sortEntries(entries)
  if (sorted.length <= threshold) return [{ year: null, entries: sorted }]

  const groups = new Map<string, PortalDocEntry[]>()
  for (const entry of sorted) {
    const year = entry.date ? entry.date.slice(0, 4) : 'Undated'
    const list = groups.get(year)
    if (list) list.push(entry)
    else groups.set(year, [entry])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === 'Undated') return 1
      if (b === 'Undated') return -1
      return b.localeCompare(a)
    })
    .map(([year, list]) => ({ year, entries: list }))
}

/** Case-insensitive search across name and sublabel. */
export function filterEntries(
  entries: PortalDocEntry[],
  query: string
): PortalDocEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(q) || e.sublabel.toLowerCase().includes(q)
  )
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface PortalCalendarEvent {
  kind: 'compliance' | 'work'
  date: string
  site_id: string
  site_name: string
  title: string
  // work events only
  edge?: 'start' | 'finish'
  work_type?: 'job' | 'project'
  number?: string
  status?: string
  // compliance events only
  item_id?: string
  item_kind?: string
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Validates a ?m= month param ('YYYY-MM'); falls back when junk. */
export function parseMonthParam(m: string | undefined, fallback: string): string {
  return m && MONTH_RE.test(m) ? m : fallback
}

/** First and last calendar day of a 'YYYY-MM' month. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(last).padStart(2, '0')}`,
  }
}

/** 'YYYY-MM' shifted by delta months (delta may be negative). */
export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 'July 2026' for '2026-07'. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/**
 * Monday-first month grid: an array of weeks, each exactly 7 cells of
 * 'YYYY-MM-DD' or null padding outside the month.
 */
export function buildMonthGrid(ym: string): (string | null)[][] {
  const [y, m] = ym.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  // getUTCDay: 0=Sun..6=Sat → Monday-first offset 0=Mon..6=Sun.
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7

  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Events keyed by their 'YYYY-MM-DD' day, preserving input order. */
export function bucketEventsByDay(
  events: PortalCalendarEvent[]
): Map<string, PortalCalendarEvent[]> {
  const map = new Map<string, PortalCalendarEvent[]>()
  for (const event of events) {
    const list = map.get(event.date)
    if (list) list.push(event)
    else map.set(event.date, [event])
  }
  return map
}

// ─── Portfolio dashboard summary ─────────────────────────────────────────────

export interface PortfolioSiteLike {
  review_dues: (string | null)[]
  open_works: number
}

export interface PortfolioSummary {
  properties: number
  /** Compliance items past their review date across the whole portfolio. */
  overdue: number
  /** Items due within the window (default 60 days), excluding overdue. */
  dueSoon: number
  /** Items inside the 30-day amber window — drives the compliance card. */
  dueSoon30: number
  /** Properties with no compliance items on record at all. */
  untracked: number
  activeWorks: number
}

export function summarisePortfolio(
  sites: PortfolioSiteLike[],
  today: string,
  dueWindowDays = 60
): PortfolioSummary {
  const horizon = addDaysISO(today, dueWindowDays)
  const amberHorizon = addDaysISO(today, 30)
  let overdue = 0
  let dueSoon = 0
  let dueSoon30 = 0
  let untracked = 0
  let activeWorks = 0

  for (const site of sites) {
    activeWorks += site.open_works
    if (site.review_dues.length === 0) untracked++
    for (const due of site.review_dues) {
      if (due === null) continue
      if (due < today) overdue++
      else {
        if (due <= horizon) dueSoon++
        if (due <= amberHorizon) dueSoon30++
      }
    }
  }

  return { properties: sites.length, overdue, dueSoon, dueSoon30, untracked, activeWorks }
}

/**
 * The property card's at-a-glance phrase + light. Counting uses the same
 * 30-day amber window as derivePropertyStatus so phrase and light agree.
 */
export function propertyStatusPhrase(
  reviewDues: (string | null)[],
  today: string
): { status: PortalPropertyStatus; phrase: string } {
  if (reviewDues.length === 0) {
    return { status: 'none', phrase: 'No compliance register on file' }
  }

  const in30 = addDaysISO(today, 30)
  let overdue = 0
  let dueSoon = 0
  for (const due of reviewDues) {
    if (due === null) continue
    if (due < today) overdue++
    else if (due <= in30) dueSoon++
  }

  if (overdue > 0) {
    return { status: 'red', phrase: `${overdue} overdue` }
  }
  if (dueSoon > 0) {
    return { status: 'amber', phrase: `${dueSoon} due soon` }
  }
  return { status: 'green', phrase: 'All current' }
}

// ─── Works grouping (live cards vs history timeline) ─────────────────────────

export type WorkGroup = 'live' | 'history'

/** Jobs: quotes/lost never reach the portal; completed states → history. */
export function workGroupForJob(status: string): WorkGroup {
  return ['completed', 'invoiced', 'paid'].includes(status) ? 'history' : 'live'
}

/** Projects: only closed is history — PC/DLP projects are still live works. */
export function workGroupForProject(status: string): WorkGroup {
  return status === 'closed' ? 'history' : 'live'
}

// ─── Work timeline (client-facing status steps) ──────────────────────────────

export const JOB_TIMELINE = ['quote', 'scheduled', 'in_progress', 'completed'] as const
export const PROJECT_TIMELINE = [
  'active',
  'practical_completion',
  'defects_liability',
  'closed',
] as const

export const WORK_STEP_LABELS: Record<string, string> = {
  quote: 'Quoted',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  active: 'Active',
  practical_completion: 'Practical completion',
  defects_liability: 'Defects liability',
  closed: 'Closed',
}

/**
 * Step index of a work's status on its client timeline; -1 when the status
 * is not on the timeline (job 'lost' never reaches the portal anyway).
 * invoiced/paid are "Completed" to the client — money stages are internal.
 */
export function workTimelineIndex(kind: 'job' | 'project', status: string): number {
  if (kind === 'job') {
    if (status === 'invoiced' || status === 'paid') return JOB_TIMELINE.length - 1
    return (JOB_TIMELINE as readonly string[]).indexOf(status)
  }
  return (PROJECT_TIMELINE as readonly string[]).indexOf(status)
}

/** Human label for a compliance item kind, safe for unknown values. */
export function itemKindLabel(kind: string): string {
  return (
    PROPERTY_COMPLIANCE_KIND_LABELS[kind as PropertyComplianceKind] ?? kind
  )
}
