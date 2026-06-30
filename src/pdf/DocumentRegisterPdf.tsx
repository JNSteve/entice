import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type DocumentRegisterPdfRow = {
  docNumber: string | null
  title: string
  category: string
  system: string
  version: string
  status: string
  issued: string | null
  approved: string | null
  reviewDue: string | null
  /** True when an issued doc is past its review date — flagged red. */
  overdue: boolean
}

export type DocumentRegisterPdfProps = {
  company: DocCompany
  /** Pre-formatted print date, e.g. "01/07/2026". */
  printedDate: string
  rows: DocumentRegisterPdfRow[]
}

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
  footerText: { flex: 1, fontSize: fontSize.xs, color: palette.slate500 },
  pageNumber: { fontSize: fontSize.xs, color: palette.slate500, flexShrink: 0 },

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
  overdue: { color: '#dc2626', fontFamily: font.bold },
})

// Landscape column widths (pt-ish via flex basis).
const col = StyleSheet.create({
  num: { width: 70 },
  title: { flex: 1 },
  cat: { width: 78 },
  sys: { width: 56 },
  ver: { width: 44 },
  status: { width: 60 },
  approved: { width: 60 },
  issued: { width: 60 },
  review: { width: 64 },
})

/**
 * Master Document List — the controlled register export (ISO 9001 §7.5): every
 * document with its number, title, category, system, version, status, approval
 * and issue dates, and review-due (overdue flagged red).
 */
export function DocumentRegisterPdf({ company, printedDate, rows }: DocumentRegisterPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title="Master Document List" author={company.name}>
      <Page size="A4" orientation="landscape" style={styles.page}>
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
            <Text style={headerStyles.title}>Master Document List</Text>
            <Text style={headerStyles.docNumber}>Controlled register</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        <View style={styles.headRow} fixed>
          <Text style={[styles.headCell, col.num]}>Doc #</Text>
          <Text style={[styles.headCell, col.title]}>Title</Text>
          <Text style={[styles.headCell, col.cat]}>Category</Text>
          <Text style={[styles.headCell, col.sys]}>System</Text>
          <Text style={[styles.headCell, col.ver]}>Version</Text>
          <Text style={[styles.headCell, col.status]}>Status</Text>
          <Text style={[styles.headCell, col.approved]}>Approved</Text>
          <Text style={[styles.headCell, col.issued]}>Issued</Text>
          <Text style={[styles.headCell, col.review]}>Review due</Text>
        </View>

        {rows.map((r, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={[styles.cellMuted, col.num]}>{r.docNumber ?? '—'}</Text>
            <Text style={[styles.cell, col.title]}>{r.title}</Text>
            <Text style={[styles.cellMuted, col.cat]}>{r.category}</Text>
            <Text style={[styles.cellMuted, col.sys]}>{r.system}</Text>
            <Text style={[styles.cellMuted, col.ver]}>{r.version}</Text>
            <Text style={[styles.cell, col.status]}>{r.status}</Text>
            <Text style={[styles.cellMuted, col.approved]}>{r.approved ?? '—'}</Text>
            <Text style={[styles.cellMuted, col.issued]}>{r.issued ?? '—'}</Text>
            <Text style={r.overdue ? [styles.cellMuted, col.review, styles.overdue] : [styles.cellMuted, col.review]}>
              {r.reviewDue ?? '—'}
            </Text>
          </View>
        ))}

        {rows.length === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 10 }]}>
            No documents on the register.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Master Document List — controlled register</Text>
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
