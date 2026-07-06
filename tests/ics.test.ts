import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  icsDate,
  icsTimestamp,
  type IcsEvent,
} from '@/lib/ics'

const NOW = new Date('2026-07-06T03:15:00.000Z')

function build(events: IcsEvent[], calendarName = 'Entice — Test') {
  return buildIcs({ calendarName, events, now: NOW })
}

/** Unfold (RFC 5545 §3.1) then split into content lines. */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter((l) => l !== '')
}

/** Every VEVENT block as its own array of unfolded lines. */
function vevents(ics: string): string[][] {
  const lines = unfold(ics)
  const blocks: string[][] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = []
    else if (line === 'END:VEVENT') {
      if (current) blocks.push(current)
      current = null
    } else if (current) current.push(line)
  }
  return blocks
}

// ─── TEXT escaping ───────────────────────────────────────────────────────────

describe('escapeIcsText', () => {
  it('escapes commas, semicolons and backslashes', () => {
    expect(escapeIcsText('Unit 4, 12 Depot Rd; rear')).toBe(
      'Unit 4\\, 12 Depot Rd\\; rear'
    )
    expect(escapeIcsText('back\\slash')).toBe('back\\\\slash')
  })

  it('escapes backslash FIRST so escapes are not double-escaped', () => {
    expect(escapeIcsText('a\\;b')).toBe('a\\\\\\;b')
  })

  it('turns any newline flavour into literal \\n', () => {
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2')
    expect(escapeIcsText('line1\r\nline2')).toBe('line1\\nline2')
    expect(escapeIcsText('line1\rline2')).toBe('line1\\nline2')
  })

  it('leaves plain text untouched', () => {
    expect(escapeIcsText('J-0008 — more acm')).toBe('J-0008 — more acm')
  })
})

// ─── Dates ───────────────────────────────────────────────────────────────────

describe('icsDate / addDaysIso', () => {
  it('formats valid dates as YYYYMMDD', () => {
    expect(icsDate('2026-07-06')).toBe('20260706')
    expect(icsDate('2026-01-01')).toBe('20260101')
  })

  it('rejects malformed and impossible dates', () => {
    expect(icsDate('2026-7-6')).toBeNull()
    expect(icsDate('06/07/2026')).toBeNull()
    expect(icsDate('2026-13-40')).toBeNull()
    expect(icsDate('2026-02-30')).toBeNull()
    expect(icsDate('')).toBeNull()
  })

  it('adds calendar days across month/year boundaries', () => {
    expect(addDaysIso('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })
})

// ─── Folding ─────────────────────────────────────────────────────────────────

describe('foldIcsLine', () => {
  it('leaves short lines alone', () => {
    expect(foldIcsLine('SUMMARY:Short')).toEqual(['SUMMARY:Short'])
  })

  it('folds long lines at 75 octets with a leading space', () => {
    const line = 'SUMMARY:' + 'a'.repeat(200)
    const folded = foldIcsLine(line)
    expect(folded.length).toBeGreaterThan(1)
    expect(folded[0].length).toBe(75)
    for (const cont of folded.slice(1)) {
      expect(cont.startsWith(' ')).toBe(true)
    }
    // Unfolding restores the original exactly.
    expect(folded[0] + folded.slice(1).map((l) => l.slice(1)).join('')).toBe(line)
  })

  it('counts octets, not characters (never splits a multi-byte char)', () => {
    const line = 'SUMMARY:' + '—'.repeat(60) // em dash = 3 UTF-8 bytes
    const folded = foldIcsLine(line)
    const encoder = new TextEncoder()
    for (const part of folded) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
    }
    expect(folded[0] + folded.slice(1).map((l) => l.slice(1)).join('')).toBe(line)
  })
})

// ─── Calendar structure ──────────────────────────────────────────────────────

describe('buildIcs', () => {
  const event: IcsEvent = {
    uid: 'assignment-abc123@entice',
    date: '2026-07-10',
    summary: 'J-0008 — more acm',
    location: 'Unit 4, 12 Depot Rd, Brendale QLD 4500',
    description: 'Bring the neg air units',
  }

  it('uses CRLF line endings exclusively, including the final line', () => {
    const ics = build([event])
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
  })

  it('wraps events in a VCALENDAR with the required properties', () => {
    const lines = unfold(build([event]))
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('PRODID:-//Entice//Calendar Feed//EN')
    expect(lines).toContain('X-WR-CALNAME:Entice — Test')
  })

  it('gives every VEVENT a UID, DTSTAMP, DTSTART and SUMMARY', () => {
    const blocks = vevents(
      build([event, { uid: 'request-r1', date: '2026-07-12', summary: 'REQ-0009 — Gutters' }])
    )
    expect(blocks.length).toBe(2)
    for (const block of blocks) {
      expect(block.some((l) => l.startsWith('UID:'))).toBe(true)
      expect(block.some((l) => l.startsWith('DTSTAMP:'))).toBe(true)
      expect(block.some((l) => l.startsWith('DTSTART;VALUE=DATE:'))).toBe(true)
      expect(block.some((l) => l.startsWith('SUMMARY:'))).toBe(true)
    }
  })

  it('renders all-day events with DTEND the following day', () => {
    const [block] = vevents(build([event]))
    expect(block).toContain('DTSTART;VALUE=DATE:20260710')
    expect(block).toContain('DTEND;VALUE=DATE:20260711')
  })

  it('escapes commas in summaries and locations end to end', () => {
    const [block] = vevents(
      build([{ ...event, summary: 'J-0009 — strip, seal & clean' }])
    )
    expect(block).toContain('SUMMARY:J-0009 — strip\\, seal & clean')
    expect(block).toContain(
      'LOCATION:Unit 4\\, 12 Depot Rd\\, Brendale QLD 4500'
    )
  })

  it('drops events with malformed dates instead of corrupting the feed', () => {
    const blocks = vevents(
      build([event, { uid: 'bad-1', date: 'not-a-date', summary: 'Broken' }])
    )
    expect(blocks.length).toBe(1)
    expect(blocks[0].some((l) => l.includes('Broken'))).toBe(false)
  })

  it('omits LOCATION/DESCRIPTION when absent', () => {
    const [block] = vevents(
      build([{ uid: 'a', date: '2026-07-10', summary: 'S' }])
    )
    expect(block.some((l) => l.startsWith('LOCATION:'))).toBe(false)
    expect(block.some((l) => l.startsWith('DESCRIPTION:'))).toBe(false)
  })

  it('stamps DTSTAMP from the injected clock in basic UTC format', () => {
    expect(icsTimestamp(NOW)).toBe('20260706T031500Z')
    const [block] = vevents(build([event]))
    expect(block).toContain('DTSTAMP:20260706T031500Z')
  })

  it('produces an empty but valid calendar for no events', () => {
    const lines = unfold(build([]))
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR')
    expect(lines.some((l) => l === 'BEGIN:VEVENT')).toBe(false)
  })
})
