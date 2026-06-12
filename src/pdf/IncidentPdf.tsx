import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { fmtDate } from '@/lib/format'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'

export type IncidentPdfAction = {
  description: string
  assigned_to: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

export type IncidentPdfProps = {
  incident: {
    number: string
    date: string
    type: string
    severity: number
    status: string
    occurred: string
    location: string | null
    project: string | null
    reportedBy: string | null
    closedAt: string | null
    description: string
    immediateAction: string | null
    photoCount: number
  }
  company: DocCompany
  actions: IncidentPdfAction[]
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
    minWidth: 100,
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
  severityDot: {
    display: 'flex',
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  footer: {
    marginTop: 12,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

// Column widths for corrective actions table
const col = StyleSheet.create({
  description: { width: '36%' },
  assignee: { width: '18%' },
  due: { width: '14%' },
  status: { width: '16%' },
  completed: { width: '16%' },
})

const SEVERITY_COLORS = ['#f59e0b', '#f59e0b', '#f59e0b', '#ef4444', '#ef4444']

function SeverityRow({ severity }: { severity: number }) {
  return (
    <View style={styles.severityDot}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor:
                i <= severity
                  ? SEVERITY_COLORS[severity - 1]
                  : palette.slate200,
            },
          ]}
        />
      ))}
      <Text style={{ fontSize: fontSize.base, marginLeft: 4 }}>
        {severity}/5
      </Text>
    </View>
  )
}

/**
 * Incident report PDF: meta block, description + immediate action,
 * corrective actions table, and photo count note.
 */
export function IncidentPdf({ incident, company, actions }: IncidentPdfProps) {
  const metaRows = [
    { label: 'Type', value: incident.type },
    { label: 'Occurred', value: incident.occurred },
    { label: 'Status', value: incident.status.charAt(0).toUpperCase() + incident.status.slice(1) },
    { label: 'Location', value: incident.location ?? '—' },
    { label: 'Project / Job', value: incident.project ?? '—' },
    { label: 'Reported by', value: incident.reportedBy ?? '—' },
  ]

  return (
    <DocShell
      title="Incident Report"
      docNumber={incident.number}
      docDate={incident.date}
      company={company}
      footerText={incident.closedAt ? `Closed ${incident.closedAt}` : undefined}
    >
      {/* Meta block */}
      <View style={styles.metaBlock}>
        {metaRows.map((m) => (
          <View key={m.label} style={styles.metaItem}>
            <Text style={styles.metaLabel}>{m.label}</Text>
            <Text style={styles.metaValue}>{m.value}</Text>
          </View>
        ))}
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Severity</Text>
          <SeverityRow severity={incident.severity} />
        </View>
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Description</Text>
        <Text style={styles.bodyText}>{incident.description}</Text>
      </View>

      {/* Immediate action */}
      {incident.immediateAction ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Immediate Action Taken</Text>
          <Text style={styles.bodyText}>{incident.immediateAction}</Text>
        </View>
      ) : null}

      {/* Corrective actions table */}
      {actions.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Corrective Actions</Text>
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, col.description]}>
                Description
              </Text>
              <Text style={[tableStyles.headCell, col.assignee]}>
                Assigned to
              </Text>
              <Text style={[tableStyles.headCell, col.due]}>Due</Text>
              <Text style={[tableStyles.headCell, col.status]}>Status</Text>
              <Text style={[tableStyles.headCell, col.completed]}>
                Completed
              </Text>
            </View>
            {actions.map((a, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, col.description]}>
                  {a.description}
                </Text>
                <Text style={[tableStyles.cellMuted, col.assignee]}>
                  {a.assigned_to ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, col.due]}>
                  {a.due_date ? fmtDate(a.due_date) : '—'}
                </Text>
                <Text style={[tableStyles.cell, col.status]}>
                  {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                </Text>
                <Text style={[tableStyles.cellMuted, col.completed]}>
                  {a.completed_at ? fmtDate(a.completed_at) : '—'}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Photo count note */}
      {incident.photoCount > 0 ? (
        <Text style={styles.footer}>
          {incident.photoCount} photo
          {incident.photoCount === 1 ? '' : 's'} attached (view online)
        </Text>
      ) : null}
    </DocShell>
  )
}
