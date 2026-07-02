import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'

export type AuditReportPdfChecklistRow = {
  label: string
  value: string
}

export type AuditReportPdfFinding = {
  classification: string
  clause_ref: string | null
  description: string
  status: string
  ncr_number: string | null
  ncr_status: string | null
}

export type AuditReportPdfProps = {
  audit: {
    number: string
    date: string
    programme: string
    area: string
    standards: string
    status: string
    auditor: string | null
    auditee: string | null
    planned: string | null
    conducted: string | null
    closed: string | null
    summary: string | null
    checklistName: string | null
  }
  company: DocCompany
  checklist: AuditReportPdfChecklistRow[]
  findings: AuditReportPdfFinding[]
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
  signRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 18,
  },
  signBlock: {
    flex: 1,
    flexDirection: 'column',
    gap: 18,
  },
  signLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate500,
    height: 24,
  },
  signLabel: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    marginTop: 3,
  },
  footer: {
    marginTop: 10,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

const checklistCol = StyleSheet.create({
  item: { width: '78%' },
  result: { width: '22%' },
})

const findingsCol = StyleSheet.create({
  classification: { width: '15%' },
  clause: { width: '13%' },
  description: { width: '40%' },
  status: { width: '10%' },
  ncr: { width: '22%' },
})

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Internal Audit Report PDF: audit metadata + standards, checklist summary
 * (conducted answers), findings table with classifications and NCR links,
 * close-out summary and an auditor/auditee sign-off block.
 */
export function AuditReportPdf({
  audit,
  company,
  checklist,
  findings,
}: AuditReportPdfProps) {
  const metaRows = [
    { label: 'Programme', value: audit.programme },
    { label: 'Area / Process', value: audit.area },
    { label: 'Standards', value: audit.standards },
    { label: 'Status', value: cap(audit.status).replace(/_/g, ' ') },
    { label: 'Auditor', value: audit.auditor ?? '—' },
    { label: 'Auditee', value: audit.auditee ?? '—' },
    { label: 'Planned', value: audit.planned ?? '—' },
    { label: 'Conducted', value: audit.conducted ?? '—' },
  ]

  return (
    <DocShell
      title="Internal Audit Report"
      docNumber={audit.number}
      docDate={audit.date}
      company={company}
      footerText={audit.closed ? `Closed ${audit.closed}` : undefined}
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

      {/* Checklist summary */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>
          Checklist{audit.checklistName ? ` — ${audit.checklistName}` : ''}
        </Text>
        {checklist.length > 0 ? (
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, checklistCol.item]}>Check item</Text>
              <Text style={[tableStyles.headCell, checklistCol.result]}>Result</Text>
            </View>
            {checklist.map((row, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, checklistCol.item]}>{row.label}</Text>
                <Text
                  style={[
                    tableStyles.cell,
                    checklistCol.result,
                    row.value === 'Minor NC' || row.value === 'Major NC'
                      ? { color: '#dc2626', fontFamily: font.bold }
                      : {},
                  ]}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.bodyText}>Checklist not conducted.</Text>
        )}
      </View>

      {/* Findings */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Findings</Text>
        {findings.length > 0 ? (
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, findingsCol.classification]}>
                Classification
              </Text>
              <Text style={[tableStyles.headCell, findingsCol.clause]}>Clause</Text>
              <Text style={[tableStyles.headCell, findingsCol.description]}>
                Description
              </Text>
              <Text style={[tableStyles.headCell, findingsCol.status]}>Status</Text>
              <Text style={[tableStyles.headCell, findingsCol.ncr]}>Linked NCR</Text>
            </View>
            {findings.map((f, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text
                  style={[
                    tableStyles.cell,
                    findingsCol.classification,
                    f.classification === 'Major NC'
                      ? { color: '#dc2626', fontFamily: font.bold }
                      : {},
                  ]}
                >
                  {f.classification}
                </Text>
                <Text style={[tableStyles.cellMuted, findingsCol.clause]}>
                  {f.clause_ref ?? '—'}
                </Text>
                <Text style={[tableStyles.cell, findingsCol.description]}>
                  {f.description}
                </Text>
                <Text style={[tableStyles.cell, findingsCol.status]}>
                  {cap(f.status)}
                </Text>
                <Text style={[tableStyles.cellMuted, findingsCol.ncr]}>
                  {f.ncr_number
                    ? `${f.ncr_number}${f.ncr_status ? ` (${f.ncr_status})` : ''}`
                    : '—'}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.bodyText}>No findings recorded.</Text>
        )}
      </View>

      {/* Close-out summary */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Close-Out Summary</Text>
        <Text style={styles.bodyText}>
          {audit.summary ?? 'No close-out summary recorded.'}
        </Text>
      </View>

      {/* Sign-off block */}
      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionHeading}>Sign-Off</Text>
        <View style={styles.signRow}>
          <View style={styles.signBlock}>
            <View>
              <View style={styles.signLine} />
              <Text style={styles.signLabel}>
                Auditor{audit.auditor ? ` — ${audit.auditor}` : ''} (signature / date)
              </Text>
            </View>
          </View>
          <View style={styles.signBlock}>
            <View>
              <View style={styles.signLine} />
              <Text style={styles.signLabel}>
                Auditee{audit.auditee ? ` — ${audit.auditee}` : ''} (signature / date)
              </Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.footer}>
        Internal audit conducted under the {audit.programme} programme — ISO
        9001/14001/45001 clause 9.2.
      </Text>
    </DocShell>
  )
}
