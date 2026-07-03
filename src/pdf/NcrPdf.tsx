import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { fmtDate } from '@/lib/format'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'

export type NcrPdfAction = {
  kind: string
  description: string
  assigned_to: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

export type NcrPdfProps = {
  ncr: {
    number: string
    date: string
    source: string
    severity: number
    status: string
    occurred: string | null
    category: string | null
    project: string | null
    vendor: string | null
    raisedBy: string | null
    description: string
    immediateAction: string | null
    rootCause: string | null
    verificationNotes: string | null
    verifiedBy: string | null
    verifiedAt: string | null
    closedAt: string | null
    photoCount: number
  }
  company: DocCompany
  actions: NcrPdfAction[]
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
  verifyBlock: {
    borderWidth: 0.5,
    borderColor: palette.slate300,
    borderRadius: 3,
    padding: 8,
  },
  footer: {
    marginTop: 12,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

const col = StyleSheet.create({
  kind: { width: '13%' },
  description: { width: '33%' },
  assignee: { width: '16%' },
  due: { width: '13%' },
  status: { width: '12%' },
  completed: { width: '13%' },
})

const SEVERITY_COLORS = ['#f59e0b', '#f59e0b', '#f59e0b', '#ef4444', '#ef4444']

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

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
                i <= severity ? SEVERITY_COLORS[severity - 1] : palette.slate200,
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
 * NCR report PDF: meta block, description / immediate action / root cause,
 * CAPA actions table, verification-of-effectiveness block, photo count.
 */
export function NcrPdf({ ncr, company, actions }: NcrPdfProps) {
  const metaRows = [
    { label: 'Source', value: ncr.source },
    { label: 'Category', value: ncr.category ?? '—' },
    { label: 'Status', value: cap(ncr.status) },
    { label: 'Occurred', value: ncr.occurred ?? '—' },
    { label: 'Project / Supplier', value: ncr.project ?? ncr.vendor ?? '—' },
    { label: 'Raised by', value: ncr.raisedBy ?? '—' },
  ]

  return (
    <DocShell
      title="Nonconformance Report"
      docNumber={ncr.number}
      docDate={ncr.date}
      company={company}
      footerText={ncr.closedAt ? `Closed ${ncr.closedAt}` : undefined}
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
          <SeverityRow severity={ncr.severity} />
        </View>
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Description</Text>
        <Text style={styles.bodyText}>{ncr.description}</Text>
      </View>

      {/* Immediate action */}
      {ncr.immediateAction ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>
            Immediate Action / Containment
          </Text>
          <Text style={styles.bodyText}>{ncr.immediateAction}</Text>
        </View>
      ) : null}

      {/* Root cause */}
      {ncr.rootCause ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Root Cause</Text>
          <Text style={styles.bodyText}>{ncr.rootCause}</Text>
        </View>
      ) : null}

      {/* CAPA actions table */}
      {actions.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Corrective / Preventive Actions</Text>
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, col.kind]}>Kind</Text>
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
                <Text style={[tableStyles.cell, col.kind]}>{cap(a.kind)}</Text>
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
                  {cap(a.status)}
                </Text>
                <Text style={[tableStyles.cellMuted, col.completed]}>
                  {a.completed_at ? fmtDate(a.completed_at) : '—'}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Verification of effectiveness */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Verification of Effectiveness</Text>
        {ncr.verificationNotes ? (
          <View style={styles.verifyBlock}>
            <Text style={styles.bodyText}>{ncr.verificationNotes}</Text>
            <Text style={[styles.footer, { marginTop: 6 }]}>
              Verified by {ncr.verifiedBy ?? '—'}
              {ncr.verifiedAt ? ` · ${ncr.verifiedAt}` : ''}
            </Text>
          </View>
        ) : (
          <Text style={styles.bodyText}>
            Not yet verified. This NCR cannot be closed until effectiveness is
            verified and all CAPA actions are complete.
          </Text>
        )}
      </View>

      {/* Photo count note */}
      {ncr.photoCount > 0 ? (
        <Text style={styles.footer}>
          {ncr.photoCount} photo{ncr.photoCount === 1 ? '' : 's'} attached (view
          online)
        </Text>
      ) : null}
    </DocShell>
  )
}
