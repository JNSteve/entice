// The field side's definition of "live" work, and the pure list logic behind
// the Jobs list. No Supabase and no React in here — it is unit tested.

export type WorkKind = 'job' | 'project'

/** After quote acceptance / scheduling, before invoicing. */
export const LIVE_JOB_STATUSES = ['scheduled', 'in_progress', 'completed'] as const

/** Everything short of closed. */
export const LIVE_PROJECT_STATUSES = [
  'active',
  'practical_completion',
  'defects_liability',
] as const

export const WORK_STATUS_LABELS: Record<string, string> = {
  quote: 'Quote',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Finished',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Lost',
  active: 'Active',
  practical_completion: 'Practical completion',
  defects_liability: 'Defects',
  closed: 'Closed',
}

export function isLiveWork(kind: WorkKind, status: string, archived: boolean): boolean {
  if (archived) return false
  const list: readonly string[] =
    kind === 'job' ? LIVE_JOB_STATUSES : LIVE_PROJECT_STATUSES
  return list.includes(status)
}

export function parseWorkKind(value: string | undefined): WorkKind | null {
  return value === 'job' || value === 'project' ? value : null
}

/** Jobs and projects are separate tables, so an id alone is not a key. */
export function workKey(kind: WorkKind, id: string): string {
  return `${kind}:${id}`
}

/** Path suffix below /field/work/[kind]/[id] ('' = Today). */
export type WorkTab = '' | 'prestart' | 'swms' | 'day' | 'diary' | 'photos' | 'docs'

export function workHref(kind: WorkKind, id: string, tab: WorkTab = ''): string {
  return `/field/work/${kind}/${id}${tab ? `/${tab}` : ''}`
}

const ALL_TABS: { tab: WorkTab; label: string }[] = [
  { tab: '', label: 'Today' },
  { tab: 'prestart', label: 'Pre-start' },
  { tab: 'swms', label: 'SWMS' },
  { tab: 'day', label: 'Day sheet' },
  { tab: 'diary', label: 'Diary' },
  { tab: 'photos', label: 'Photos' },
  { tab: 'docs', label: 'Docs' },
]

/** The diary table belongs to projects only, so jobs have no Diary tab. */
export function workTabs(kind: WorkKind): { tab: WorkTab; label: string }[] {
  return kind === 'project' ? ALL_TABS : ALL_TABS.filter((t) => t.tab !== 'diary')
}

export interface LiveWorkRow {
  kind: WorkKind
  id: string
  /** As stored — already carries its prefix (RJ26018, RP26020). */
  number: string
  title: string
  status: string
  client: string | null
  site: string | null
}

export interface LiveWorkGroups {
  scheduled: LiveWorkRow[]
  live: LiveWorkRow[]
  finished: LiveWorkRow[]
}

const newestFirst = (a: LiveWorkRow, b: LiveWorkRow) =>
  b.number.localeCompare(a.number, 'en', { numeric: true })

/**
 * Splits live work into the three Jobs-list groups. Work scheduled for the
 * person today always goes in `scheduled`, whatever its status.
 */
export function groupLiveWork(
  rows: LiveWorkRow[],
  scheduledKeys: ReadonlySet<string>
): LiveWorkGroups {
  const groups: LiveWorkGroups = { scheduled: [], live: [], finished: [] }
  for (const r of rows) {
    if (scheduledKeys.has(workKey(r.kind, r.id))) groups.scheduled.push(r)
    else if (r.kind === 'job' && r.status === 'completed') groups.finished.push(r)
    else groups.live.push(r)
  }
  groups.scheduled.sort(newestFirst)
  groups.live.sort(newestFirst)
  groups.finished.sort(newestFirst)
  return groups
}

/** Case-insensitive match on number, title, client and site. */
export function searchLiveWork(rows: LiveWorkRow[], query: string): LiveWorkRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) =>
    [r.number, r.title, r.client, r.site].some((v) => v?.toLowerCase().includes(q))
  )
}
