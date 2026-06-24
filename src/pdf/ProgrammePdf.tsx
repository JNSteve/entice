import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type ProgrammePdfTask = {
  id: string
  name: string
  phase: string | null
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD
  progressPct: number
  baselineStart: string | null
  baselineEnd: string | null
}

export type ProgrammePdfLink = {
  predecessorId: string
  successorId: string
}

export type ProgrammePdfHoldPoint = {
  taskId: string
  title: string
  date: string // YYYY-MM-DD
  status: 'pending' | 'notified' | 'released'
}

export type ProgrammePdfProps = {
  project: { name: string; number: string }
  company: DocCompany
  /** Pre-formatted print date, e.g. "12/06/2026". */
  printedDate: string
  baselineSet: boolean
  tasks: ProgrammePdfTask[]
  links: ProgrammePdfLink[]
  holdPoints: ProgrammePdfHoldPoint[]
}

const HOLD_COLOURS: Record<ProgrammePdfHoldPoint['status'], string> = {
  pending: '#dc2626',
  notified: '#d97706',
  released: '#16a34a',
}

const BAR_BG = palette.slate200
const BAR_FILL = palette.navyLight
const BASELINE = palette.slate400

const FOOTER_HEIGHT = 40

const styles = StyleSheet.create({
  page: {
    fontFamily: font.regular,
    fontSize: fontSize.base,
    color: palette.slate900,
    paddingTop: 32,
    paddingHorizontal: 36,
    paddingBottom: FOOTER_HEIGHT + 18,
    backgroundColor: palette.white,
  },
  footer: {
    position: 'absolute',
    left: 36,
    right: 36,
    bottom: 18,
    borderTopWidth: 0.5,
    borderTopColor: palette.slate300,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  footerText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
  pageNumber: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    flexShrink: 0,
  },

  // ── Chart rows ──────────────────────────────────────────────────────────
  headRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate100,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    alignItems: 'stretch',
  },
  headCell: {
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  phaseRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate50,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  phaseLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    paddingVertical: 3,
    paddingHorizontal: 3,
  },
  taskRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    alignItems: 'stretch',
  },
  cell: {
    fontSize: fontSize.sm,
    color: palette.slate900,
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  cellMuted: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  right: { textAlign: 'right' },

  barsCell: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: 0.5,
    borderLeftColor: palette.slate300,
  },
  gridline: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0.5,
    backgroundColor: palette.slate200,
  },
  monthLabel: {
    position: 'absolute',
    top: 4,
    fontSize: fontSize.xs,
    color: palette.slate500,
    paddingLeft: 2,
  },

  // ── Legend ──────────────────────────────────────────────────────────────
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendText: {
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

// Fixed left-pane column widths (pt).
const col = StyleSheet.create({
  num: { width: 16 },
  name: { width: 116 },
  dates: { width: 78 },
  pct: { width: 26 },
  pred: { width: 34 },
})

const TASK_ROW_H = 17
const BAR_H = 7
const BAR_TOP = 3
const DIAMOND = 5

function dd(s: string): string {
  return format(parseISO(s), 'dd/MM')
}

/**
 * Project programme export: landscape A4 Gantt with a fixed task pane
 * (numbered rows grouped by phase, predecessor references) and a
 * percentage-positioned bar area — month gridlines, progress fill, baseline
 * ghosts and hold point diamonds. Scales to any date range.
 */
export function ProgrammePdf({
  project,
  company,
  printedDate,
  baselineSet,
  tasks,
  links,
  holdPoints,
}: ProgrammePdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  // ── Group by phase, ordered chronologically (matches the on-screen Gantt):
  //    tasks within a phase by start date, phases by their earliest task.
  const groups: { phase: string | null; tasks: ProgrammePdfTask[] }[] = []
  {
    const byPhase = new Map<string, ProgrammePdfTask[]>()
    const phaseOf = new Map<string, string | null>()
    for (const t of tasks) {
      const key = t.phase ?? ''
      if (!byPhase.has(key)) {
        byPhase.set(key, [])
        phaseOf.set(key, t.phase)
      }
      byPhase.get(key)!.push(t)
    }
    const withEarliest = Array.from(byPhase.entries()).map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start))
      return {
        phase: phaseOf.get(key) ?? null,
        tasks: sorted,
        earliest: sorted[0]?.start ?? '',
      }
    })
    withEarliest.sort((a, b) => a.earliest.localeCompare(b.earliest))
    for (const { phase, tasks: t } of withEarliest)
      groups.push({ phase, tasks: t })
  }
  const rowNumber = new Map<string, number>()
  {
    let n = 1
    for (const g of groups) for (const t of g.tasks) rowNumber.set(t.id, n++)
  }

  const predsByTask = new Map<string, number[]>()
  for (const l of links) {
    const n = rowNumber.get(l.predecessorId)
    if (n === undefined || !rowNumber.has(l.successorId)) continue
    const list = predsByTask.get(l.successorId)
    if (list) list.push(n)
    else predsByTask.set(l.successorId, [n])
  }
  for (const list of predsByTask.values()) list.sort((a, b) => a - b)

  // ── Date range (covers bars, baselines and hold points, padded 3 days)
  let min = tasks[0]?.start ?? format(new Date(), 'yyyy-MM-dd')
  let max = tasks[0]?.end ?? min
  for (const t of tasks) {
    if (t.start < min) min = t.start
    if (t.end > max) max = t.end
    if (t.baselineStart && t.baselineStart < min) min = t.baselineStart
    if (t.baselineEnd && t.baselineEnd > max) max = t.baselineEnd
  }
  for (const hp of holdPoints) {
    if (hp.date < min) min = hp.date
    if (hp.date > max) max = hp.date
  }
  const rangeStart = addDays(parseISO(min), -3)
  const rangeEnd = addDays(parseISO(max), 3)
  const totalDays = differenceInCalendarDays(rangeEnd, rangeStart) + 1

  const pctOf = (date: string) =>
    (differenceInCalendarDays(parseISO(date), rangeStart) / totalDays) * 100
  const widthPct = (start: string, end: string) =>
    ((differenceInCalendarDays(parseISO(end), parseISO(start)) + 1) /
      totalDays) *
    100

  // ── Month gridlines (1st of each month inside the range)
  const months: { pct: number; label: string }[] = []
  {
    let m = startOfMonth(rangeStart)
    if (m < rangeStart) m = startOfMonth(addDays(m, 35))
    while (m <= rangeEnd) {
      months.push({
        pct: (differenceInCalendarDays(m, rangeStart) / totalDays) * 100,
        label: format(m, 'MMM yy'),
      })
      m = startOfMonth(addDays(m, 35))
    }
  }

  const gridlines = (
    <>
      {months.map((m, i) => (
        <View key={i} style={[styles.gridline, { left: `${m.pct}%` }]} />
      ))}
    </>
  )

  const holdByTask = new Map<string, ProgrammePdfHoldPoint[]>()
  for (const hp of holdPoints) {
    const list = holdByTask.get(hp.taskId)
    if (list) list.push(hp)
    else holdByTask.set(hp.taskId, [hp])
  }

  return (
    <Document title={`Programme — ${project.number}`} author={company.name}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={headerStyles.bar}>
          <View style={headerStyles.companyBlock}>
            {company.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
              <Image src={company.logoUrl} style={headerStyles.logo} />
            ) : null}
            <Text style={headerStyles.companyName}>{company.name}</Text>
            {companyLines.map((line, j) => (
              <Text key={j} style={headerStyles.companyLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={headerStyles.titleBlock}>
            <Text style={headerStyles.title}>Programme</Text>
            <Text style={headerStyles.docNumber}>
              {project.name} ({project.number})
            </Text>
            <Text style={headerStyles.docDate}>
              Printed {printedDate} ·{' '}
              {baselineSet ? 'Baseline set' : 'No baseline set'}
            </Text>
          </View>
        </View>

        {/* Head row */}
        <View style={styles.headRow} fixed>
          <Text style={[styles.headCell, col.num]}>#</Text>
          <Text style={[styles.headCell, col.name]}>Task</Text>
          <Text style={[styles.headCell, col.dates]}>Dates</Text>
          <Text style={[styles.headCell, col.pct, styles.right]}>%</Text>
          <Text style={[styles.headCell, col.pred]}>Pred.</Text>
          <View style={[styles.barsCell, { height: 16 }]}>
            {gridlines}
            {months.map((m, i) => (
              <Text key={i} style={[styles.monthLabel, { left: `${m.pct}%`, top: 3 }]}>
                {m.label}
              </Text>
            ))}
          </View>
        </View>

        {/* Phase groups + task rows */}
        {groups.map((g) => (
          <View key={g.phase ?? '∅'}>
            <View style={styles.phaseRow} wrap={false}>
              <Text style={[styles.phaseLabel, { width: 270 }]}>
                {g.phase ?? 'No phase'}
              </Text>
              <View style={[styles.barsCell, { height: 13 }]}>{gridlines}</View>
            </View>
            {g.tasks.map((t) => {
              const hps = holdByTask.get(t.id) ?? []
              const preds = predsByTask.get(t.id)
              return (
                <View key={t.id} style={styles.taskRow} wrap={false}>
                  <Text style={[styles.cellMuted, col.num]}>
                    {rowNumber.get(t.id)}
                  </Text>
                  <Text style={[styles.cell, col.name]}>{t.name}</Text>
                  <Text style={[styles.cellMuted, col.dates]}>
                    {dd(t.start)} – {dd(t.end)}
                  </Text>
                  <Text style={[styles.cellMuted, col.pct, styles.right]}>
                    {Math.round(t.progressPct)}
                  </Text>
                  <Text style={[styles.cellMuted, col.pred]}>
                    {preds ? preds.join(', ') : '—'}
                  </Text>
                  <View style={[styles.barsCell, { height: TASK_ROW_H }]}>
                    {gridlines}
                    {/* Baseline ghost */}
                    {t.baselineStart && t.baselineEnd ? (
                      <View
                        style={{
                          position: 'absolute',
                          left: `${pctOf(t.baselineStart)}%`,
                          width: `${widthPct(t.baselineStart, t.baselineEnd)}%`,
                          top: BAR_TOP + BAR_H + 2,
                          height: 2.5,
                          borderRadius: 1,
                          backgroundColor: BASELINE,
                        }}
                      />
                    ) : null}
                    {/* Bar + progress fill */}
                    <View
                      style={{
                        position: 'absolute',
                        left: `${pctOf(t.start)}%`,
                        width: `${widthPct(t.start, t.end)}%`,
                        top: BAR_TOP,
                        height: BAR_H,
                        borderRadius: 1.5,
                        backgroundColor: BAR_BG,
                        overflow: 'hidden',
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.max(0, Math.min(100, t.progressPct))}%`,
                          height: BAR_H,
                          backgroundColor: BAR_FILL,
                        }}
                      />
                    </View>
                    {/* Hold point diamonds */}
                    {hps.map((hp, i) => (
                      <View
                        key={i}
                        style={{
                          position: 'absolute',
                          left: `${pctOf(hp.date)}%`,
                          marginLeft: -DIAMOND / 2,
                          top: BAR_TOP + (BAR_H - DIAMOND) / 2,
                          width: DIAMOND,
                          height: DIAMOND,
                          transform: 'rotate(45deg)',
                          backgroundColor: HOLD_COLOURS[hp.status],
                        }}
                      />
                    ))}
                  </View>
                </View>
              )
            })}
          </View>
        ))}

        {/* Legend */}
        <View style={styles.legendRow} wrap={false}>
          <View style={styles.legendItem}>
            <View
              style={{ width: 14, height: 6, borderRadius: 1.5, backgroundColor: BAR_BG }}
            />
            <Text style={styles.legendText}>Task</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={{ width: 14, height: 6, borderRadius: 1.5, backgroundColor: BAR_FILL }}
            />
            <Text style={styles.legendText}>Progress</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={{ width: 14, height: 2.5, borderRadius: 1, backgroundColor: BASELINE }}
            />
            <Text style={styles.legendText}>Baseline</Text>
          </View>
          {(['pending', 'notified', 'released'] as const).map((s) => (
            <View key={s} style={styles.legendItem}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  transform: 'rotate(45deg)',
                  backgroundColor: HOLD_COLOURS[s],
                }}
              />
              <Text style={styles.legendText}>
                Hold point ({s})
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Programme — {project.number} {project.name}
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </View>
      </Page>
    </Document>
  )
}
