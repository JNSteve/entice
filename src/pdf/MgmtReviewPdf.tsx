import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'

// Management Review Report (ISO 9001/14001/45001 §9.3). THE 9.3 evidence an
// auditor reads: review metadata + attendees, every mandated 9.3.2 input with
// its RAG, minute and the frozen register snapshot figures, the general
// minutes, and the 9.3.3 outputs (decisions/actions with owners + due dates).

export type MgmtReviewPdfAttendee = {
  name: string
  role_title: string | null
  external: boolean
}

export type MgmtReviewPdfSnapshotFigure = { label: string; value: string }
export type MgmtReviewPdfSnapshotRow = {
  label: string
  value: string
  flag?: 'red' | 'amber' | 'green'
}

export type MgmtReviewPdfInput = {
  label: string
  standards: string
  rag: 'green' | 'amber' | 'red' | null
  ragLabel: string | null
  minute: string | null
  reviewed: boolean
  reviewedLine: string | null
  windowLine: string | null
  figures: MgmtReviewPdfSnapshotFigure[]
  rows: MgmtReviewPdfSnapshotRow[]
}

export type MgmtReviewPdfAction = {
  description: string
  assigned_to: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

export type MgmtReviewPdfProps = {
  review: {
    number: string
    date: string
    periodCovered: string | null
    chair: string | null
    status: string
    closed: string | null
    generalMinutes: string | null
  }
  company: DocCompany
  attendees: MgmtReviewPdfAttendee[]
  inputs: MgmtReviewPdfInput[]
  actions: MgmtReviewPdfAction[]
}

const RAG_COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
}

const styles = StyleSheet.create({
  metaBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingBottom: 12,
  },
  metaItem: {
    flexDirection: 'column',
    gap: 2,
    minWidth: 90,
  },
  metaLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  section: {
    marginBottom: 12,
  },
  sectionHeading: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate300,
    paddingBottom: 3,
  },
  bodyText: {
    fontSize: fontSize.base,
    color: palette.slate700,
    lineHeight: 1.6,
  },
  inputBlock: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  inputHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 2,
  },
  inputTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.base,
    color: palette.slate900,
    flex: 1,
  },
  inputStandards: {
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
  ragBadge: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  figuresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 3,
    marginBottom: 3,
  },
  figure: {
    flexDirection: 'column',
    gap: 1,
  },
  figureLabel: {
    fontSize: 6.5,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  figureValue: {
    fontSize: fontSize.sm,
    fontFamily: font.bold,
    color: palette.slate900,
  },
  snapshotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 1,
  },
  snapshotLabel: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    flex: 1,
  },
  snapshotValue: {
    fontSize: fontSize.xs,
    color: palette.slate700,
    flexShrink: 0,
  },
  windowLine: {
    fontSize: 6.5,
    color: palette.slate500,
    marginTop: 2,
  },
  minute: {
    fontSize: fontSize.base,
    color: palette.slate700,
    lineHeight: 1.5,
    marginTop: 3,
  },
  minuteMissing: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    marginTop: 3,
  },
  reviewedLine: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    marginTop: 2,
  },
  notReviewed: {
    fontSize: fontSize.xs,
    color: '#dc2626',
    fontFamily: font.bold,
    marginTop: 2,
  },
  footer: {
    marginTop: 10,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

const attendeeCol = StyleSheet.create({
  name: { width: '45%' },
  role: { width: '35%' },
  type: { width: '20%' },
})

const actionCol = StyleSheet.create({
  description: { width: '46%' },
  owner: { width: '20%' },
  due: { width: '12%' },
  status: { width: '10%' },
  completed: { width: '12%' },
})

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function MgmtReviewPdf({
  review,
  company,
  attendees,
  inputs,
  actions,
}: MgmtReviewPdfProps) {
  const metaRows = [
    { label: 'Review date', value: review.date },
    { label: 'Period covered', value: review.periodCovered ?? '—' },
    { label: 'Chaired by', value: review.chair ?? '—' },
    { label: 'Status', value: cap(review.status).replace(/_/g, ' ') },
    { label: 'Closed', value: review.closed ?? '—' },
  ]

  return (
    <DocShell
      title="Management Review Report"
      docNumber={review.number}
      docDate={review.date}
      company={company}
      footerText={
        review.closed
          ? `Minutes locked on close (${review.closed}) — controlled record per INT-PRO-003`
          : 'Review in progress — minutes not yet locked'
      }
    >
      {/* Meta block */}
      <View style={styles.metaBlock}>
        {metaRows.map((m) => (
          <View key={m.label} style={styles.metaItem}>
            <Text style={styles.metaLabel}>{m.label}</Text>
            <Text style={styles.metaValue}>{m.value}</Text>
          </View>
        ))}
      </View>

      {/* Attendees */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Attendees</Text>
        {attendees.length > 0 ? (
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, attendeeCol.name]}>Name</Text>
              <Text style={[tableStyles.headCell, attendeeCol.role]}>Role / title</Text>
              <Text style={[tableStyles.headCell, attendeeCol.type]}>Type</Text>
            </View>
            {attendees.map((a, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, attendeeCol.name]}>{a.name}</Text>
                <Text style={[tableStyles.cellMuted, attendeeCol.role]}>
                  {a.role_title ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, attendeeCol.type]}>
                  {a.external ? 'External' : 'Internal'}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.bodyText}>No attendees recorded.</Text>
        )}
      </View>

      {/* Inputs — ISO 9.3.2 */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Review Inputs (ISO 9.3.2)</Text>
        {inputs.map((input, i) => (
          <View key={i} style={styles.inputBlock} wrap={false}>
            <View style={styles.inputHeadRow}>
              <Text style={styles.inputTitle}>
                {i + 1}. {input.label}
              </Text>
              <Text
                style={[
                  styles.ragBadge,
                  { color: input.rag ? RAG_COLOR[input.rag] : palette.slate500 },
                ]}
              >
                {input.ragLabel ?? 'Not rated'}
              </Text>
            </View>
            <Text style={styles.inputStandards}>Required by {input.standards}</Text>

            {input.figures.length > 0 && (
              <View style={styles.figuresRow}>
                {input.figures.map((f) => (
                  <View key={f.label} style={styles.figure}>
                    <Text style={styles.figureLabel}>{f.label}</Text>
                    <Text style={styles.figureValue}>{f.value}</Text>
                  </View>
                ))}
              </View>
            )}
            {input.rows.map((r, j) => (
              <View key={j} style={styles.snapshotRow}>
                <Text style={styles.snapshotLabel}>{r.label}</Text>
                <Text
                  style={[
                    styles.snapshotValue,
                    r.flag ? { color: RAG_COLOR[r.flag], fontFamily: font.bold } : {},
                  ]}
                >
                  {r.value}
                </Text>
              </View>
            ))}
            {input.windowLine && (
              <Text style={styles.windowLine}>{input.windowLine}</Text>
            )}

            {input.minute ? (
              <Text style={styles.minute}>{input.minute}</Text>
            ) : (
              <Text style={styles.minuteMissing}>No minute recorded.</Text>
            )}
            {input.reviewed ? (
              <Text style={styles.reviewedLine}>{input.reviewedLine}</Text>
            ) : (
              <Text style={styles.notReviewed}>Not marked reviewed</Text>
            )}
          </View>
        ))}
      </View>

      {/* General minutes */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>General Minutes</Text>
        <Text style={styles.bodyText}>
          {review.generalMinutes ?? 'No general minutes recorded.'}
        </Text>
      </View>

      {/* Outputs — ISO 9.3.3 */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>
          Outputs — Decisions &amp; Actions (ISO 9.3.3)
        </Text>
        {actions.length > 0 ? (
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, actionCol.description]}>
                Decision / action
              </Text>
              <Text style={[tableStyles.headCell, actionCol.owner]}>Owner</Text>
              <Text style={[tableStyles.headCell, actionCol.due]}>Due</Text>
              <Text style={[tableStyles.headCell, actionCol.status]}>Status</Text>
              <Text style={[tableStyles.headCell, actionCol.completed]}>Completed</Text>
            </View>
            {actions.map((a, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, actionCol.description]}>
                  {a.description}
                </Text>
                <Text style={[tableStyles.cellMuted, actionCol.owner]}>
                  {a.assigned_to ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, actionCol.due]}>
                  {a.due_date ?? '—'}
                </Text>
                <Text style={[tableStyles.cell, actionCol.status]}>{cap(a.status)}</Text>
                <Text style={[tableStyles.cellMuted, actionCol.completed]}>
                  {a.completed_at ?? '—'}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.bodyText}>No output actions recorded.</Text>
        )}
      </View>

      <Text style={styles.footer}>
        Management review conducted per the Management Review Procedure
        (INT-PRO-003) — ISO 9001/14001/45001 clause 9.3. Output actions are
        tracked to completion in the management review register.
      </Text>
    </DocShell>
  )
}
