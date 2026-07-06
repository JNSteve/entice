import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type WasteReconciliationPdfRow = {
  reference: string
  description: string | null
  classification: string
  /** e.g. '250 m³' */
  allowance: string
  /** e.g. '180.5 m³' */
  used: string
  /** e.g. '72.2%' — null when the allowance is not positive. */
  pctUsed: string | null
  level: 'ok' | 'warn' | 'over'
  expiry: string | null
  expired: boolean
  otherUnitCount: number
}

export type WasteReconciliationPdfProps = {
  company: DocCompany
  printedDate: string
  project: { number: string; name: string }
  rows: WasteReconciliationPdfRow[]
  /** e.g. '18 loads · 142.5 t · 36 m³ (3 loads not booked to a permit)' */
  loadsSummary: string
}

const FOOTER_HEIGHT = 40

const LEVEL_COLORS: Record<WasteReconciliationPdfRow['level'], string> = {
  ok: '#16a34a',
  warn: '#d97706',
  over: '#dc2626',
}

const LEVEL_LABELS: Record<WasteReconciliationPdfRow['level'], string> = {
  ok: 'OK',
  warn: '>= 80% used',
  over: 'OVER ALLOWANCE',
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

  projectLine: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
    marginTop: 12,
  },
  summary: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 2,
    marginBottom: 4,
  },
  headRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate100,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginTop: 8,
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
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  cell: { fontSize: fontSize.sm, color: palette.slate900, paddingHorizontal: 2 },
  cellMuted: { fontSize: fontSize.sm, color: palette.slate500, paddingHorizontal: 2 },
  level: { fontFamily: font.bold },
  note: { fontSize: fontSize.xs, color: palette.slate500, marginTop: 1 },
  expired: { color: '#dc2626', fontFamily: font.bold },
})

const col = StyleSheet.create({
  reference: { flex: 1.3 },
  classification: { width: 105 },
  allowance: { width: 75, textAlign: 'right' as const },
  used: { width: 75, textAlign: 'right' as const },
  pct: { width: 55, textAlign: 'right' as const },
  status: { width: 95 },
  expiry: { width: 65 },
})

/**
 * Per-project waste reconciliation (ISO 14001 8.1 / 9.1): each permit's
 * allowance vs the loads booked against it, with the 80% warning threshold.
 */
export function WasteReconciliationPdf({
  company,
  printedDate,
  project,
  rows,
  loadsSummary,
}: WasteReconciliationPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title="Waste Reconciliation" author={company.name}>
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
            <Text style={headerStyles.title}>Waste Reconciliation</Text>
            <Text style={headerStyles.docNumber}>ISO 14001 8.1 / 9.1</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        <Text style={styles.projectLine}>
          {project.number} — {project.name}
        </Text>
        <Text style={styles.summary}>{loadsSummary}</Text>

        <View style={styles.headRow}>
          <Text style={[styles.headCell, col.reference]}>Permit / approval</Text>
          <Text style={[styles.headCell, col.classification]}>Classification</Text>
          <Text style={[styles.headCell, col.allowance]}>Allowance</Text>
          <Text style={[styles.headCell, col.used]}>Used</Text>
          <Text style={[styles.headCell, col.pct]}>% used</Text>
          <Text style={[styles.headCell, col.status]}>Status</Text>
          <Text style={[styles.headCell, col.expiry]}>Expiry</Text>
        </View>
        {rows.map((r) => (
          <View key={r.reference} style={styles.row} wrap={false}>
            <View style={col.reference}>
              <Text style={styles.cell}>{r.reference}</Text>
              {r.description ? (
                <Text style={styles.note}>{r.description}</Text>
              ) : null}
              {r.otherUnitCount > 0 ? (
                <Text style={styles.note}>
                  +{r.otherUnitCount} load{r.otherUnitCount === 1 ? '' : 's'} in
                  the other unit (not converted)
                </Text>
              ) : null}
            </View>
            <Text style={[styles.cellMuted, col.classification]}>
              {r.classification}
            </Text>
            <Text style={[styles.cell, col.allowance]}>{r.allowance}</Text>
            <Text style={[styles.cell, col.used]}>{r.used}</Text>
            <Text style={[styles.cell, col.pct]}>{r.pctUsed ?? '—'}</Text>
            <Text
              style={[
                styles.cell,
                styles.level,
                col.status,
                { color: LEVEL_COLORS[r.level] },
              ]}
            >
              {LEVEL_LABELS[r.level]}
            </Text>
            <Text
              style={[r.expired ? styles.expired : styles.cellMuted, col.expiry]}
            >
              {r.expiry ?? '—'}
            </Text>
          </View>
        ))}
        {rows.length === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 10 }]}>
            No permits recorded for this project.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Waste Reconciliation — usage sums only loads recorded in each
            permit&apos;s own unit; loads in the other unit are noted, never
            converted. Warning threshold 80% of allowance; over-allowance loads
            carry a recorded override reason on the load record.
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
