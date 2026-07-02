import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type RiskRegisterPdfRow = {
  number: string
  kind: 'risk' | 'opportunity'
  title: string
  category: string | null
  scope: string
  likelihood: number
  consequence: number
  inherentScore: number
  inherentRating: string
  residualScore: number | null
  residualRating: string | null
  status: string
  owner: string | null
  reviewDue: string | null
  /** True when an open item is past its review date — flagged red. */
  reviewOverdue: boolean
}

export type RiskRegisterPdfGroup = {
  /** e.g. "Quality (9001)" */
  domain: string
  rows: RiskRegisterPdfRow[]
}

export type RiskRegisterBandCount = {
  band: string
  inherent: number
  residual: number
}

export type RiskRegisterPdfProps = {
  company: DocCompany
  printedDate: string
  groups: RiskRegisterPdfGroup[]
  /** Heat-map summary — item counts per rating band (Low→Extreme). */
  bandCounts: RiskRegisterBandCount[]
}

const FOOTER_HEIGHT = 40

const RATING_COLORS: Record<string, string> = {
  Low: '#16a34a',
  Medium: '#ca8a04',
  High: '#ea580c',
  Extreme: '#dc2626',
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

  // Band summary
  summaryBlock: { marginBottom: 12 },
  summaryTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  summaryHead: {
    flexDirection: 'row',
    backgroundColor: palette.slate100,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  summaryCell: { fontSize: fontSize.sm, paddingHorizontal: 2 },
  summaryHeadCell: {
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: 2,
  },

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
  rating: { fontFamily: font.bold },
  overdue: { color: '#dc2626', fontFamily: font.bold },
  kindTag: { fontSize: fontSize.xs, color: palette.slate500 },
})

// Landscape column widths.
const col = StyleSheet.create({
  num: { width: 52 },
  title: { flex: 1 },
  cat: { width: 70 },
  scope: { width: 80 },
  lxc: { width: 40 },
  inherent: { width: 66 },
  residual: { width: 66 },
  status: { width: 52 },
  owner: { width: 70 },
  review: { width: 56 },
})

const sum = StyleSheet.create({
  band: { width: 90 },
  count: { width: 90 },
})

/**
 * Risk & Opportunity Register export (ISO 9001/14001/45001 §6.1): all items
 * grouped by ISO domain with inherent and residual 5×5 ratings, plus a small
 * heat-map summary (item counts per rating band). Ratings are the DB-generated
 * values from the fixed risk_rating() bands.
 */
export function RiskRegisterPdf({
  company,
  printedDate,
  groups,
  bandCounts,
}: RiskRegisterPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  return (
    <Document title="Risk & Opportunity Register" author={company.name}>
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
            <Text style={headerStyles.title}>Risk & Opportunity Register</Text>
            <Text style={headerStyles.docNumber}>ISO 6.1 — 5×5 matrix</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        {/* Heat-map summary: counts per rating band */}
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryTitle}>
            Rating summary — {total} item{total === 1 ? '' : 's'}
          </Text>
          <View style={styles.summaryHead}>
            <Text style={[styles.summaryHeadCell, sum.band]}>Band</Text>
            <Text style={[styles.summaryHeadCell, sum.count]}>Inherent</Text>
            <Text style={[styles.summaryHeadCell, sum.count]}>Residual</Text>
          </View>
          {bandCounts.map((b) => (
            <View key={b.band} style={styles.summaryRow}>
              <Text
                style={[
                  styles.summaryCell,
                  styles.rating,
                  sum.band,
                  { color: RATING_COLORS[b.band] ?? palette.slate900 },
                ]}
              >
                {b.band}
              </Text>
              <Text style={[styles.summaryCell, sum.count]}>{b.inherent}</Text>
              <Text style={[styles.summaryCell, sum.count]}>{b.residual}</Text>
            </View>
          ))}
        </View>

        {/* Register grouped by ISO domain */}
        {groups.map((g) => (
          <View key={g.domain}>
            <Text style={styles.groupTitle}>{g.domain}</Text>
            <View style={styles.headRow}>
              <Text style={[styles.headCell, col.num]}>Number</Text>
              <Text style={[styles.headCell, col.title]}>Title</Text>
              <Text style={[styles.headCell, col.cat]}>Category</Text>
              <Text style={[styles.headCell, col.scope]}>Scope</Text>
              <Text style={[styles.headCell, col.lxc]}>L×C</Text>
              <Text style={[styles.headCell, col.inherent]}>Inherent</Text>
              <Text style={[styles.headCell, col.residual]}>Residual</Text>
              <Text style={[styles.headCell, col.status]}>Status</Text>
              <Text style={[styles.headCell, col.owner]}>Owner</Text>
              <Text style={[styles.headCell, col.review]}>Review</Text>
            </View>
            {g.rows.map((r) => (
              <View key={r.number} style={styles.row} wrap={false}>
                <Text style={[styles.cellMuted, col.num]}>{r.number}</Text>
                <View style={col.title}>
                  <Text style={styles.cell}>{r.title}</Text>
                  {r.kind === 'opportunity' ? (
                    <Text style={styles.kindTag}>Opportunity</Text>
                  ) : null}
                </View>
                <Text style={[styles.cellMuted, col.cat]}>
                  {r.category ?? '—'}
                </Text>
                <Text style={[styles.cellMuted, col.scope]}>{r.scope}</Text>
                <Text style={[styles.cellMuted, col.lxc]}>
                  {r.likelihood}×{r.consequence}
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.rating,
                    col.inherent,
                    { color: RATING_COLORS[r.inherentRating] ?? palette.slate900 },
                  ]}
                >
                  {r.inherentRating} {r.inherentScore}
                </Text>
                {r.residualRating && r.residualScore != null ? (
                  <Text
                    style={[
                      styles.cell,
                      styles.rating,
                      col.residual,
                      {
                        color:
                          RATING_COLORS[r.residualRating] ?? palette.slate900,
                      },
                    ]}
                  >
                    {r.residualRating} {r.residualScore}
                  </Text>
                ) : (
                  <Text style={[styles.cellMuted, col.residual]}>—</Text>
                )}
                <Text style={[styles.cell, col.status]}>{r.status}</Text>
                <Text style={[styles.cellMuted, col.owner]}>
                  {r.owner ?? '—'}
                </Text>
                <Text
                  style={
                    r.reviewOverdue
                      ? [styles.cellMuted, col.review, styles.overdue]
                      : [styles.cellMuted, col.review]
                  }
                >
                  {r.reviewDue ?? '—'}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {total === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 10 }]}>
            No items on the register.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Risk & Opportunity Register — fixed 5×5 matrix (Low 1–4, Medium 5–9,
            High 10–16, Extreme 17–25)
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
