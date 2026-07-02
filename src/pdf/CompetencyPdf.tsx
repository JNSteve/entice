import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type CompetencyPdfRecord = {
  number: string
  competency: string
  category: string
  issuer: string | null
  reference: string | null
  issued: string
  expiry: string | null
  /** 'current' | 'expiring' | 'expired' | 'superseded' */
  status: 'current' | 'expiring' | 'expired' | 'superseded'
}

export type CompetencyPdfProps = {
  company: DocCompany
  printedDate: string
  worker: {
    name: string
    role: string
    company: string | null
  }
  /** Required-for-role summary lines, e.g. "White Card — Current (no expiry)". */
  requirements: { name: string; statusLabel: string; mandatory: boolean }[]
  records: CompetencyPdfRecord[]
}

const FOOTER_HEIGHT = 40

const STATUS_LABEL: Record<CompetencyPdfRecord['status'], string> = {
  current: 'Current',
  expiring: 'Expiring (30d)',
  expired: 'Expired',
  superseded: 'Superseded',
}

const STATUS_COLOUR: Record<CompetencyPdfRecord['status'], string> = {
  current: '#16a34a',
  expiring: '#d97706',
  expired: '#dc2626',
  superseded: palette.slate500,
}

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
  footerText: { flex: 1, fontSize: fontSize.xs, color: palette.slate500 },
  pageNumber: { fontSize: fontSize.xs, color: palette.slate500, flexShrink: 0 },

  sectionTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 14,
    marginBottom: 6,
  },
  metaRow: { flexDirection: 'row', gap: 24, marginTop: 4 },
  metaLabel: { fontSize: fontSize.xs, color: palette.slate500 },
  metaValue: { fontSize: fontSize.sm, color: palette.slate900 },

  reqLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  reqName: { fontSize: fontSize.sm, color: palette.slate900 },
  reqStatus: { fontSize: fontSize.sm },

  headRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate100,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  headCell: {
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: 2,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  cell: { fontSize: fontSize.sm, color: palette.slate900, paddingHorizontal: 2 },
  cellMuted: { fontSize: fontSize.sm, color: palette.slate500, paddingHorizontal: 2 },
})

const col = StyleSheet.create({
  num: { width: 55 },
  competency: { flex: 1 },
  category: { width: 55 },
  issuer: { width: 80 },
  ref: { width: 75 },
  issued: { width: 55 },
  expiry: { width: 55 },
  status: { width: 70 },
})

/**
 * Per-worker competency report (ISO 7.2): the worker's required-for-role
 * summary plus every record (superseded history included) with derived status.
 */
export function CompetencyPdf({
  company,
  printedDate,
  worker,
  requirements,
  records,
}: CompetencyPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title={`Competency Report — ${worker.name}`} author={company.name}>
      <Page size="A4" style={styles.page}>
        <View style={headerStyles.bar}>
          <View style={headerStyles.companyBlock}>
            {company.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
              <Image src={company.logoUrl} style={headerStyles.logo} />
            ) : null}
            <Text style={headerStyles.companyName}>{company.name}</Text>
            {companyLines.map((line, i) => (
              <Text key={i} style={headerStyles.companyLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={headerStyles.titleBlock}>
            <Text style={headerStyles.title}>Competency Report</Text>
            <Text style={headerStyles.docNumber}>{worker.name}</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Worker</Text>
            <Text style={styles.metaValue}>{worker.name}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Role</Text>
            <Text style={styles.metaValue}>{worker.role}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Company</Text>
            <Text style={styles.metaValue}>{worker.company ?? 'Employee'}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Required for role</Text>
        {requirements.length === 0 ? (
          <Text style={styles.cellMuted}>
            No competency requirements configured for this role.
          </Text>
        ) : (
          requirements.map((r, i) => (
            <View key={i} style={styles.reqLine} wrap={false}>
              <Text style={styles.reqName}>
                {r.name}
                {r.mandatory ? '' : ' (desirable)'}
              </Text>
              <Text style={styles.reqStatus}>{r.statusLabel}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Records</Text>
        <View style={styles.headRow} fixed>
          <Text style={[styles.headCell, col.num]}>#</Text>
          <Text style={[styles.headCell, col.competency]}>Competency</Text>
          <Text style={[styles.headCell, col.category]}>Category</Text>
          <Text style={[styles.headCell, col.issuer]}>Issuer</Text>
          <Text style={[styles.headCell, col.ref]}>Reference</Text>
          <Text style={[styles.headCell, col.issued]}>Issued</Text>
          <Text style={[styles.headCell, col.expiry]}>Expiry</Text>
          <Text style={[styles.headCell, col.status]}>Status</Text>
        </View>
        {records.map((r, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={[styles.cellMuted, col.num]}>{r.number}</Text>
            <Text
              style={
                r.status === 'superseded'
                  ? [styles.cellMuted, col.competency]
                  : [styles.cell, col.competency]
              }
            >
              {r.competency}
            </Text>
            <Text style={[styles.cellMuted, col.category]}>{r.category}</Text>
            <Text style={[styles.cellMuted, col.issuer]}>{r.issuer ?? '—'}</Text>
            <Text style={[styles.cellMuted, col.ref]}>{r.reference ?? '—'}</Text>
            <Text style={[styles.cellMuted, col.issued]}>{r.issued}</Text>
            <Text style={[styles.cellMuted, col.expiry]}>{r.expiry ?? '—'}</Text>
            <Text
              style={[
                styles.cell,
                col.status,
                {
                  color: STATUS_COLOUR[r.status],
                  fontFamily: r.status === 'expired' ? font.bold : font.regular,
                },
              ]}
            >
              {STATUS_LABEL[r.status]}
            </Text>
          </View>
        ))}
        {records.length === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 6 }]}>
            No competency records on file.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Competency Report — training &amp; competency register (ISO 7.2)
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
