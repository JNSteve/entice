import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type LegalRegisterPdfRow = {
  number: string
  title: string
  /** e.g. 'Act · Queensland' */
  categoryJurisdiction: string
  howWeComply: string | null
  responsible: string | null
  /** e.g. 'Compliant — 12/06/2026' or 'Not evaluated' */
  lastVerdict: string
  /** compliant / gap / not_evaluated — drives the verdict colour */
  compliance: string
  nextReview: string | null
  reviewOverdue: boolean
  retired: boolean
}

export type LegalRegisterPdfGroup = {
  domain: string
  rows: LegalRegisterPdfRow[]
}

export type LegalRegisterPdfProps = {
  company: DocCompany
  printedDate: string
  groups: LegalRegisterPdfGroup[]
}

const FOOTER_HEIGHT = 40

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant: '#16a34a',
  gap: '#dc2626',
  not_evaluated: palette.slate500,
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

  groupTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 4,
  },
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
  verdict: { fontFamily: font.bold },
  overdue: { color: '#dc2626', fontFamily: font.bold },
})

// Landscape column widths.
const col = StyleSheet.create({
  num: { width: 52 },
  title: { flex: 1 },
  cat: { width: 110 },
  comply: { flex: 1.3 },
  responsible: { width: 70 },
  verdict: { width: 105 },
  review: { width: 62 },
})

/**
 * Legal & Compliance Obligations Register export (ISO 6.1.3 / 9.1.2), grouped
 * by ISO domain: what each obligation is, how the company complies, who owns
 * it, the latest evaluation verdict and the next scheduled evaluation.
 */
export function LegalRegisterPdf({
  company,
  printedDate,
  groups,
}: LegalRegisterPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  const total = groups.reduce((s, g) => s + g.rows.length, 0)

  return (
    <Document title="Legal & Compliance Obligations Register" author={company.name}>
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
            <Text style={headerStyles.title}>Legal & Compliance Register</Text>
            <Text style={headerStyles.docNumber}>ISO 6.1.3 / 9.1.2</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        {groups.map((g) => (
          <View key={g.domain}>
            <Text style={styles.groupTitle}>
              {g.domain} — {g.rows.length} obligation
              {g.rows.length === 1 ? '' : 's'}
            </Text>
            <View style={styles.headRow}>
              <Text style={[styles.headCell, col.num]}>Number</Text>
              <Text style={[styles.headCell, col.title]}>Obligation</Text>
              <Text style={[styles.headCell, col.cat]}>Category</Text>
              <Text style={[styles.headCell, col.comply]}>How we comply</Text>
              <Text style={[styles.headCell, col.responsible]}>Responsible</Text>
              <Text style={[styles.headCell, col.verdict]}>Last verdict</Text>
              <Text style={[styles.headCell, col.review]}>Next review</Text>
            </View>
            {g.rows.map((r) => (
              <View key={r.number} style={styles.row} wrap={false}>
                <Text style={[styles.cellMuted, col.num]}>{r.number}</Text>
                <Text style={[styles.cell, col.title]}>
                  {r.title}
                  {r.retired ? ' (retired)' : ''}
                </Text>
                <Text style={[styles.cellMuted, col.cat]}>
                  {r.categoryJurisdiction}
                </Text>
                <Text style={[styles.cellMuted, col.comply]}>
                  {r.howWeComply ?? '—'}
                </Text>
                <Text style={[styles.cellMuted, col.responsible]}>
                  {r.responsible ?? '—'}
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.verdict,
                    col.verdict,
                    {
                      color:
                        COMPLIANCE_COLORS[r.compliance] ?? palette.slate900,
                    },
                  ]}
                >
                  {r.lastVerdict}
                </Text>
                <Text
                  style={[
                    r.reviewOverdue ? styles.overdue : styles.cellMuted,
                    col.review,
                  ]}
                >
                  {r.nextReview ?? '—'}
                </Text>
              </View>
            ))}
          </View>
        ))}
        {total === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 10 }]}>
            No obligations on the register.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Legal & Compliance Obligations Register — compliance state is
            derived from the latest evaluation on each obligation (append-only
            history); a gap escalates into the NCR/CAPA register. Seed content
            is Rev A — HSEQ review before relying on this for audit.
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
