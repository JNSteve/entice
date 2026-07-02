// All server-side 'today'/date-window logic must go through these so record
// dates are correct on a UTC server (e.g. Vercel). The company is QLD-based;
// Australia/Brisbane = AEST (UTC+10), no daylight saving.
//
// REGRESSION GUARD: never derive a 'today'/date string for STORAGE, DEFAULTING,
// or a "is this date in the future / today / yesterday" GUARD from the server's
// local clock (`new Date()` getters, `toISOString().slice(0,10)`, date-fns
// `format(new Date(), …)`). Route it through the helpers below instead. Display
// of an already-stored date string (fmtDate, etc.) does not need these.
const TZ = 'Australia/Brisbane'

/** 'YYYY-MM-DD' for the given instant in Australian (Brisbane) time. */
export function todayAU(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

/** 'YYYY-MM-DD' offset by n days from the AU 'today' (n may be negative). */
export function dateAU(offsetDays = 0, now: Date = new Date()): string {
  const base = todayAU(now)
  // Pure calendar-date arithmetic: treat the AU date as a UTC midnight and shift
  // whole days. Brisbane has no DST, so no offset edge cases apply here.
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' for the AU day before 'today'. */
export function yesterdayAU(now: Date = new Date()): string {
  return dateAU(-1, now)
}

/** true if dateStr (YYYY-MM-DD) is after AU today. */
export function isFutureAU(dateStr: string, now: Date = new Date()): boolean {
  return dateStr > todayAU(now)
}

/**
 * Interpret a datetime-local input value ('YYYY-MM-DDTHH:MM', optionally with
 * seconds) as BRISBANE wall-clock time and return the corresponding UTC
 * instant as an ISO string for storage. Never parse these strings with a bare
 * `new Date(str)` (server-local — wrong on a UTC host) or store them raw
 * (Postgres reads them as UTC — also wrong). Brisbane has no DST, so a fixed
 * +10:00 offset is always correct.
 *
 * Throws on values that don't parse to a real date (e.g. '2026-13-40T99:99').
 */
export function auLocalToInstant(datetimeLocal: string): string {
  // datetime-local omits seconds unless a sub-minute step is set; normalise.
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(datetimeLocal)
    ? `${datetimeLocal}:00`
    : datetimeLocal
  const d = new Date(`${withSeconds}+10:00`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid datetime-local value: ${datetimeLocal}`)
  }
  return d.toISOString()
}

/**
 * A Date whose *local* getters (getFullYear/getMonth/getDate, and therefore
 * date-fns helpers like format/startOfDay/differenceInCalendarDays that read the
 * local components) reflect the Brisbane wall-clock for `now`. Use this when a
 * server component/action must hand a Date — not a string — to date logic that
 * reads local components, so a UTC server still computes against the AU calendar
 * day. The instant itself is shifted, so only use the date components, not for
 * persisting a precise timestamp.
 */
export function nowAU(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  // hour can come back as '24' at midnight in some environments; normalise.
  const hour = get('hour') % 24
  return new Date(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second')
  )
}
