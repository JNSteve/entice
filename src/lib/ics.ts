// iCalendar (RFC 5545) generation for the private calendar feeds
// (/api/calendar/staff/[token] and /api/calendar/portal/[token]). PURE — no
// Supabase or Next imports, so vitest exercises the exact bytes calendar apps
// parse. Scope is deliberately tiny: all-day (date-only) events, which is all
// the schedule data carries (assignments/compliance/works are calendar days,
// no time of day).
//
// Format rules this file owns (and tests/ics.test.ts proves):
//   * CRLF line endings everywhere.
//   * TEXT escaping: backslash, semicolon, comma, newline (RFC 5545 §3.3.11).
//   * Line folding at 75 octets (UTF-8 bytes, not chars — §3.1).
//   * Every VEVENT carries UID / DTSTAMP / DTSTART, all-day DTEND = date + 1.

export type IcsEvent = {
  /** Stable per source record — calendar apps use it to update, not duplicate. */
  uid: string
  /** All-day date, 'YYYY-MM-DD'. Events with malformed dates are dropped. */
  date: string
  summary: string
  description?: string | null
  location?: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** RFC 5545 TEXT escaping: \ ; , and newlines (CR dropped, LF → \n). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** 'YYYY-MM-DD' → 'YYYYMMDD'; null for anything malformed. */
export function icsDate(date: string): string | null {
  if (!DATE_RE.test(date)) return null
  // Reject impossible calendar dates (2026-13-40) via UTC round-trip.
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  if (d.toISOString().slice(0, 10) !== date) return null
  return date.replaceAll('-', '')
}

/** Calendar-day arithmetic on 'YYYY-MM-DD' (n may be negative). */
export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Folds one content line at 75 octets (UTF-8), continuation lines indented
 * with a single space (RFC 5545 §3.1). Never splits inside a multi-byte
 * character.
 */
export function foldIcsLine(line: string): string[] {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return [line]

  const out: string[] = []
  let current = ''
  let currentBytes = 0
  // First line gets 75 octets; continuations start with a space so 74 remain.
  let budget = 75
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length
    if (currentBytes + chBytes > budget) {
      out.push(current)
      current = ' '
      currentBytes = 1
      budget = 75
    }
    current += ch
    currentBytes += chBytes
  }
  if (current !== '' && current !== ' ') out.push(current)
  return out
}

/** UTC instant → iCalendar basic format, e.g. 20260706T031500Z. */
export function icsTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Builds a complete VCALENDAR of all-day events. Events with malformed dates
 * are skipped (defensive: a bad row must never corrupt the whole feed).
 */
export function buildIcs(opts: {
  calendarName: string
  events: IcsEvent[]
  /** Injectable for tests; defaults to the real clock. */
  now?: Date
}): string {
  const stamp = icsTimestamp(opts.now ?? new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Entice//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(opts.calendarName)}`,
    'X-WR-TIMEZONE:Australia/Brisbane',
  ]

  for (const event of opts.events) {
    const start = icsDate(event.date)
    if (!start || !event.uid) continue
    const end = icsDate(addDaysIso(event.date, 1))
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcsText(event.summary)}`
    )
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    }
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    }
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.flatMap(foldIcsLine).join('\r\n') + '\r\n'
}
