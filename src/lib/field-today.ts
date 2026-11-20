// Wording for the job screen's Today checklist, and the hours maths behind
// "Your hours". Pure — unit tested.
import type { WorkTab } from '@/lib/live-work'

const TZ = 'Australia/Brisbane'

/** '6:50 am' — Brisbane wall-clock time for a stored UTC instant. */
export function fmtTimeAU(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(iso))
    // ICU versions disagree on the space before am/pm (plain, NBSP, narrow NBSP).
    .replace(/[  ]/g, ' ')
    .toLowerCase()
}

/**
 * '20/11/2026' — the Brisbane calendar date of a stored UTC instant. Use this,
 * not fmtDate(), for timestamps rendered on the server: fmtDate formats in the
 * server's own zone, which is UTC in production, so anything recorded before
 * 10 am Brisbane would show the previous day.
 */
export function fmtDateAU(iso: string): string {
  // en-CA formats as YYYY-MM-DD.
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
    .format(new Date(iso))
    .split('-')
  return `${d}/${m}/${y}`
}

export interface TodayStatus {
  /** submitted_at of today's pre-start meeting on this work, or null. */
  prestartSubmittedAt: string | null
  /** Active SWMS issued to this work. */
  swmsTotal: number
  /** Of those, how many the person has not signed at the current version. */
  swmsToSign: number
  /** Today's materials / plant / subbie lines. */
  usageCount: number
  /** null for jobs — only projects keep a diary. */
  diarySaved: boolean | null
  photoCount: number
}

export interface TodayRow {
  key: 'prestart' | 'swms' | 'day' | 'diary' | 'photos'
  label: string
  tab: WorkTab
  chip: string
  tone: 'ok' | 'warn' | 'neutral'
}

export function todayRows(s: TodayStatus): TodayRow[] {
  const rows: TodayRow[] = [
    s.prestartSubmittedAt
      ? { key: 'prestart', label: 'Pre-start meeting', tab: 'prestart', chip: `Done ${fmtTimeAU(s.prestartSubmittedAt)}`, tone: 'ok' }
      : { key: 'prestart', label: 'Pre-start meeting', tab: 'prestart', chip: 'To do', tone: 'warn' },
    s.swmsTotal === 0
      ? { key: 'swms', label: 'SWMS sign-on', tab: 'swms', chip: 'None issued', tone: 'neutral' }
      : s.swmsToSign > 0
        ? { key: 'swms', label: 'SWMS sign-on', tab: 'swms', chip: `${s.swmsToSign} to sign`, tone: 'warn' }
        : { key: 'swms', label: 'SWMS sign-on', tab: 'swms', chip: 'All signed', tone: 'ok' },
    {
      key: 'day',
      label: 'Day sheet',
      tab: 'day',
      chip: s.usageCount > 0 ? `${s.usageCount} logged` : 'Nothing yet',
      tone: 'neutral',
    },
  ]
  if (s.diarySaved !== null) {
    rows.push(
      s.diarySaved
        ? { key: 'diary', label: 'Diary', tab: 'diary', chip: 'Saved', tone: 'ok' }
        : { key: 'diary', label: 'Diary', tab: 'diary', chip: 'Not started', tone: 'neutral' }
    )
  }
  rows.push({
    key: 'photos',
    label: 'Photos',
    tab: 'photos',
    chip: s.photoCount > 0 ? `${s.photoCount} today` : 'None today',
    tone: 'neutral',
  })
  return rows
}

/** Decimal hours from start to finish; an open entry (null finish) runs to `now`. */
export function hoursBetween(startIso: string, endIso: string | null, now: Date): number {
  const end = endIso ? new Date(endIso).getTime() : now.getTime()
  return Math.max(0, end - new Date(startIso).getTime()) / 3600000
}

/** '3 h 18 m' */
export function fmtDuration(hours: number): string {
  const mins = Math.round(hours * 60)
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} m`
}
