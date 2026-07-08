import { Text, View, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, font, fontSize, tableStyles } from './theme'

/**
 * Property compliance report — the board-pack artifact: per-property register
 * status, works history and upcoming renewals. Built for both the office
 * route (no watermark) and the portal route (watermarked).
 */

export interface ReportItem {
  kindLabel: string
  title: string
  issuedDisplay: string
  reviewDueDisplay: string | null
  status: 'green' | 'amber' | 'red'
}

export interface ReportWork {
  label: string
  completedDisplay: string | null
}

export interface ReportSite {
  name: string
  address: string | null
  items: ReportItem[]
  works: ReportWork[]
}

export interface ComplianceReportData {
  clientName: string
  generatedDisplay: string
  summary: { properties: number; current: number; dueSoon: number; overdue: number }
  upcoming: { label: string; dueDisplay: string }[]
  sites: ReportSite[]
}

const STATUS_LABEL: Record<ReportItem['status'], string> = {
  green: 'Current',
  amber: 'Due soon',
  red: 'Overdue',
}

const STATUS_COLOR: Record<ReportItem['status'], string> = {
  green: '#15803d',
  amber: '#b45309',
  red: '#dc2626',
}

const styles = StyleSheet.create({
  intro: {
    fontSize: fontSize.base,
    color: palette.slate700,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  summaryBox: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: palette.slate300,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  summaryValue: {
    fontFamily: font.bold,
    fontSize: 16,
  },
  summaryLabel: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 2,
  },
  siteBlock: {
    marginBottom: 16,
  },
  siteAddress: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: -10,
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  worksHeading: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  workLine: {
    fontSize: fontSize.base,
    color: palette.slate700,
    paddingHorizontal: 8,
    marginBottom: 2,
  },
  emptyLine: {
    fontSize: fontSize.base,
    color: palette.slate500,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  upcomingBlock: {
    marginBottom: 16,
  },
})

const COL = {
  status: { width: 62 },
  doc: { flex: 1 },
  kind: { width: 110 },
  issued: { width: 60 },
  due: { width: 66 },
}

export function ComplianceReportPdf({
  data,
  company,
  watermark,
}: {
  data: ComplianceReportData
  company: DocCompany
  watermark?: string | null
}) {
  const { summary } = data
  return (
    <DocShell
      title="Compliance report"
      docNumber={data.clientName}
      docDate={data.generatedDisplay}
      company={company}
      watermark={watermark ?? null}
      footerText={`Property compliance report prepared by ${company.name}. Status reflects the register on ${data.generatedDisplay}.`}
    >
      <Text style={styles.intro}>
        Property compliance across {summary.properties}{' '}
        {summary.properties === 1 ? 'property' : 'properties'} for{' '}
        {data.clientName}, as at {data.generatedDisplay}.
      </Text>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryValue}>{summary.properties}</Text>
          <Text style={styles.summaryLabel}>Properties</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={[styles.summaryValue, { color: STATUS_COLOR.green }]}>
            {summary.current}
          </Text>
          <Text style={styles.summaryLabel}>Current documents</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={[styles.summaryValue, { color: STATUS_COLOR.amber }]}>
            {summary.dueSoon}
          </Text>
          <Text style={styles.summaryLabel}>Due within 30 days</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={[styles.summaryValue, { color: STATUS_COLOR.red }]}>
            {summary.overdue}
          </Text>
          <Text style={styles.summaryLabel}>Overdue</Text>
        </View>
      </View>

      {/* Upcoming renewals (next 90 days) */}
      <View style={styles.upcomingBlock}>
        <View style={tableStyles.sectionTitleRow}>
          <Text style={tableStyles.sectionTitle}>
            Upcoming renewals — next 90 days
          </Text>
        </View>
        {data.upcoming.length === 0 ? (
          <Text style={[styles.emptyLine, { marginTop: 4 }]}>
            Nothing due for renewal in the next 90 days.
          </Text>
        ) : (
          data.upcoming.map((u, i) => (
            <View key={i} style={tableStyles.row}>
              <Text style={[tableStyles.cell, COL.doc]}>{u.label}</Text>
              <Text style={[tableStyles.cell, COL.due, tableStyles.right]}>
                {u.dueDisplay}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Per-property register */}
      {data.sites.map((site, i) => (
        <View key={i} style={styles.siteBlock} wrap={site.items.length > 12}>
          <View style={tableStyles.sectionTitleRow}>
            <Text style={tableStyles.sectionTitle}>{site.name}</Text>
          </View>
          {site.address ? (
            <Text style={[styles.siteAddress, { marginTop: 3 }]}>
              {site.address}
            </Text>
          ) : null}

          {site.items.length === 0 ? (
            <Text style={styles.emptyLine}>
              No compliance documents on record.
            </Text>
          ) : (
            <View style={tableStyles.table}>
              <View style={tableStyles.headRow}>
                <Text style={[tableStyles.headCell, COL.status]}>Status</Text>
                <Text style={[tableStyles.headCell, COL.doc]}>Document</Text>
                <Text style={[tableStyles.headCell, COL.kind]}>Type</Text>
                <Text style={[tableStyles.headCell, COL.issued]}>Issued</Text>
                <Text style={[tableStyles.headCell, COL.due, tableStyles.right]}>
                  Review due
                </Text>
              </View>
              {site.items.map((item, j) => (
                <View key={j} style={tableStyles.row}>
                  <Text
                    style={[
                      tableStyles.cell,
                      COL.status,
                      { color: STATUS_COLOR[item.status], fontFamily: font.bold },
                    ]}
                  >
                    {STATUS_LABEL[item.status]}
                  </Text>
                  <Text style={[tableStyles.cell, COL.doc]}>{item.title}</Text>
                  <Text style={[tableStyles.cellMuted, COL.kind]}>
                    {item.kindLabel}
                  </Text>
                  <Text style={[tableStyles.cellMuted, COL.issued]}>
                    {item.issuedDisplay}
                  </Text>
                  <Text style={[tableStyles.cell, COL.due, tableStyles.right]}>
                    {item.reviewDueDisplay ?? '—'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {site.works.length > 0 && (
            <>
              <Text style={styles.worksHeading}>Completed works</Text>
              {site.works.map((w, j) => (
                <Text key={j} style={styles.workLine}>
                  • {w.label}
                  {w.completedDisplay ? ` — completed ${w.completedDisplay}` : ''}
                </Text>
              ))}
            </>
          )}
        </View>
      ))}
    </DocShell>
  )
}
