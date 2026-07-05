import { describe, expect, it } from 'vitest'
import {
  addMonths,
  bucketEventsByDay,
  buildMonthGrid,
  fileTypeOf,
  filterEntries,
  fmtBytes,
  folderForItemKind,
  groupEntriesByYear,
  monthLabel,
  monthRange,
  parseMonthParam,
  propertyStatusPhrase,
  sortEntries,
  summarisePortfolio,
  workGroupForJob,
  workGroupForProject,
  type PortalCalendarEvent,
  type PortalDocEntry,
} from '@/lib/portal-experience'

const TODAY = '2026-07-05'

// ─── Folder classification ───────────────────────────────────────────────────

describe('folderForItemKind', () => {
  it('registers, plans, surveys and contaminated land file under Compliance', () => {
    expect(folderForItemKind('asbestos_register')).toBe('compliance')
    expect(folderForItemKind('asbestos_mgmt_plan')).toBe('compliance')
    expect(folderForItemKind('hazmat_survey')).toBe('compliance')
    expect(folderForItemKind('contaminated_land')).toBe('compliance')
  })

  it('clearances and air monitoring file under Certificates', () => {
    expect(folderForItemKind('clearance_certificate')).toBe('certificates')
    expect(folderForItemKind('air_monitoring')).toBe('certificates')
  })

  it('custom/other items file under Reports', () => {
    expect(folderForItemKind('other')).toBe('reports')
  })
})

// ─── File types ──────────────────────────────────────────────────────────────

describe('fileTypeOf', () => {
  it('content type wins when present', () => {
    expect(fileTypeOf('scan.weird', 'application/pdf')).toBe('pdf')
    expect(fileTypeOf('photo.bin', 'image/jpeg')).toBe('image')
    expect(fileTypeOf('data.bin', 'text/csv')).toBe('sheet')
    expect(
      fileTypeOf(
        'x',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
    ).toBe('sheet')
    expect(
      fileTypeOf(
        'x',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('doc')
  })

  it('falls back to the filename extension', () => {
    expect(fileTypeOf('survey.pdf', null)).toBe('pdf')
    expect(fileTypeOf('site.JPG', null)).toBe('image')
    expect(fileTypeOf('register.xlsx', null)).toBe('sheet')
    expect(fileTypeOf('letter.docx', null)).toBe('doc')
    expect(fileTypeOf('archive.zip', null)).toBe('other')
    expect(fileTypeOf(null, null)).toBe('other')
  })
})

describe('fmtBytes', () => {
  it('formats bytes, KB and MB; blank for unknown', () => {
    expect(fmtBytes(null)).toBe('')
    expect(fmtBytes(undefined)).toBe('')
    expect(fmtBytes(-1)).toBe('')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(348160)).toBe('340 KB')
    expect(fmtBytes(12_690_000)).toBe('12.1 MB')
  })
})

// ─── Entries: sort / group / filter ──────────────────────────────────────────

function entry(partial: Partial<PortalDocEntry> & { id: string }): PortalDocEntry {
  return {
    folder: 'compliance',
    name: partial.id,
    sublabel: '',
    date: null,
    size: null,
    fileType: 'pdf',
    href: '#',
    ...partial,
  }
}

describe('sortEntries', () => {
  it('sorts newest first with undated entries last', () => {
    const sorted = sortEntries([
      entry({ id: 'a', date: '2025-01-01' }),
      entry({ id: 'b', date: null }),
      entry({ id: 'c', date: '2026-06-30' }),
    ])
    expect(sorted.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('groupEntriesByYear', () => {
  it('8 or fewer entries stay in one flat group', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry({ id: `e${i}`, date: `202${i % 3}-01-0${i + 1}` })
    )
    const groups = groupEntriesByYear(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].year).toBeNull()
    expect(groups[0].entries).toHaveLength(8)
  })

  it('more than 8 entries group by year, newest year first, undated last', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) =>
        entry({ id: `a${i}`, date: `2026-0${i + 1}-01` })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        entry({ id: `b${i}`, date: `2024-0${i + 1}-01` })
      ),
      entry({ id: 'undated', date: null }),
    ]
    const groups = groupEntriesByYear(entries)
    expect(groups.map((g) => g.year)).toEqual(['2026', '2024', 'Undated'])
    expect(groups[0].entries).toHaveLength(5)
    expect(groups[1].entries).toHaveLength(4)
    expect(groups[2].entries.map((e) => e.id)).toEqual(['undated'])
  })
})

describe('filterEntries', () => {
  const entries = [
    entry({ id: '1', name: 'Asbestos Survey 2026.pdf', sublabel: 'HAZMAT survey' }),
    entry({ id: '2', name: 'clearance.pdf', sublabel: 'Clearance certificate' }),
  ]

  it('matches name and sublabel case-insensitively', () => {
    expect(filterEntries(entries, 'SURVEY')).toHaveLength(1)
    expect(filterEntries(entries, 'certificate')).toHaveLength(1)
    expect(filterEntries(entries, 'zzz')).toHaveLength(0)
  })

  it('blank query returns everything', () => {
    expect(filterEntries(entries, '  ')).toHaveLength(2)
  })
})

// ─── Calendar month helpers ──────────────────────────────────────────────────

describe('parseMonthParam', () => {
  it('accepts YYYY-MM and rejects junk', () => {
    expect(parseMonthParam('2026-07', '2026-01')).toBe('2026-07')
    expect(parseMonthParam('2026-13', '2026-01')).toBe('2026-01')
    expect(parseMonthParam('2026-00', '2026-01')).toBe('2026-01')
    expect(parseMonthParam('garbage', '2026-01')).toBe('2026-01')
    expect(parseMonthParam(undefined, '2026-01')).toBe('2026-01')
  })
})

describe('monthRange', () => {
  it('covers the full calendar month', () => {
    expect(monthRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(monthRange('2026-06')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })

  it('handles February and leap years', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
    expect(monthRange('2028-02').to).toBe('2028-02-29')
  })
})

describe('addMonths', () => {
  it('moves forward and backward across year boundaries', () => {
    expect(addMonths('2026-07', 1)).toBe('2026-08')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-07', -12)).toBe('2025-07')
  })
})

describe('monthLabel', () => {
  it('formats human month names', () => {
    expect(monthLabel('2026-07')).toBe('July 2026')
    expect(monthLabel('2025-12')).toBe('December 2025')
  })
})

describe('buildMonthGrid', () => {
  it('July 2026 starts on a Wednesday (Monday-first grid)', () => {
    const grid = buildMonthGrid('2026-07')
    // 2026-07-01 is a Wednesday → two leading nulls (Mon, Tue).
    expect(grid[0]).toEqual([
      null,
      null,
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ])
    // Every week has exactly 7 cells; all 31 days present.
    expect(grid.every((week) => week.length === 7)).toBe(true)
    const days = grid.flat().filter(Boolean)
    expect(days).toHaveLength(31)
    expect(days[30]).toBe('2026-07-31')
  })

  it('a month starting on Monday has no leading padding', () => {
    // 2026-06-01 is a Monday.
    const grid = buildMonthGrid('2026-06')
    expect(grid[0][0]).toBe('2026-06-01')
  })
})

describe('bucketEventsByDay', () => {
  it('groups events by day preserving order', () => {
    const events: PortalCalendarEvent[] = [
      { kind: 'compliance', date: '2026-07-05', site_id: 's1', site_name: 'A', title: 'Register' },
      { kind: 'work', date: '2026-07-05', site_id: 's1', site_name: 'A', title: 'Job', edge: 'start' },
      { kind: 'work', date: '2026-07-13', site_id: 's2', site_name: 'B', title: 'Project', edge: 'start' },
    ]
    const buckets = bucketEventsByDay(events)
    expect(buckets.get('2026-07-05')).toHaveLength(2)
    expect(buckets.get('2026-07-05')?.[0].kind).toBe('compliance')
    expect(buckets.get('2026-07-13')).toHaveLength(1)
    expect(buckets.get('2026-07-01')).toBeUndefined()
  })
})

// ─── Portfolio summary ───────────────────────────────────────────────────────

describe('summarisePortfolio', () => {
  it('counts properties, overdue, due-soon (60d), untracked and works', () => {
    const summary = summarisePortfolio(
      [
        // overdue + one due in 10 days
        { review_dues: ['2026-07-01', '2026-07-15'], open_works: 2 },
        // due at exactly +60 days (inclusive) + a never-expiring item
        { review_dues: ['2026-09-03', null], open_works: 0 },
        // untracked property
        { review_dues: [], open_works: 1 },
        // all current (beyond 60 days)
        { review_dues: ['2026-09-04'], open_works: 0 },
      ],
      TODAY
    )
    expect(summary).toEqual({
      properties: 4,
      overdue: 1,
      dueSoon: 2,
      dueSoon30: 1, // only the +10-day item is inside the amber window
      untracked: 1,
      activeWorks: 3,
    })
  })

  it('empty portfolio is all zeros', () => {
    expect(summarisePortfolio([], TODAY)).toEqual({
      properties: 0,
      overdue: 0,
      dueSoon: 0,
      dueSoon30: 0,
      untracked: 0,
      activeWorks: 0,
    })
  })

  it('dueSoon30 matches the 30-day amber boundary', () => {
    // +30 in window, +31 out — same rule as the property lights.
    const s = summarisePortfolio(
      [{ review_dues: ['2026-08-04', '2026-08-05'], open_works: 0 }],
      TODAY
    )
    expect(s.dueSoon30).toBe(1)
    expect(s.dueSoon).toBe(2)
  })
})

describe('propertyStatusPhrase', () => {
  it('no records → red', () => {
    expect(propertyStatusPhrase([], TODAY)).toEqual({
      status: 'red',
      phrase: 'No compliance records',
    })
  })

  it('overdue wins over due-soon', () => {
    expect(propertyStatusPhrase(['2026-07-01', '2026-07-20'], TODAY)).toEqual({
      status: 'red',
      phrase: '1 overdue',
    })
  })

  it('due within 30 days → amber with count', () => {
    expect(
      propertyStatusPhrase(['2026-07-20', '2026-08-04', '2027-01-01'], TODAY)
    ).toEqual({ status: 'amber', phrase: '2 due soon' })
  })

  it('everything current (or non-expiring) → green', () => {
    expect(propertyStatusPhrase([null, '2027-01-01'], TODAY)).toEqual({
      status: 'green',
      phrase: 'All current',
    })
  })

  it('phrase status agrees with the 30-day light boundary', () => {
    // +30 days = amber; +31 = green (matches derivePropertyStatus).
    expect(propertyStatusPhrase(['2026-08-04'], TODAY).status).toBe('amber')
    expect(propertyStatusPhrase(['2026-08-05'], TODAY).status).toBe('green')
  })
})

// ─── Works grouping ──────────────────────────────────────────────────────────

describe('work grouping', () => {
  it('jobs: completed/invoiced/paid are history, the rest live', () => {
    expect(workGroupForJob('scheduled')).toBe('live')
    expect(workGroupForJob('in_progress')).toBe('live')
    expect(workGroupForJob('completed')).toBe('history')
    expect(workGroupForJob('invoiced')).toBe('history')
    expect(workGroupForJob('paid')).toBe('history')
  })

  it('projects: only closed is history (PC/DLP still live)', () => {
    expect(workGroupForProject('active')).toBe('live')
    expect(workGroupForProject('practical_completion')).toBe('live')
    expect(workGroupForProject('defects_liability')).toBe('live')
    expect(workGroupForProject('closed')).toBe('history')
  })
})
