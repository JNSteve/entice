import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type MatrixPdfCell = {
  /** 'current' | 'expiring' | 'expired' | 'missing' | null (not required, no record) */
  status: 'current' | 'expiring' | 'expired' | 'missing' | null
  /** Pre-formatted expiry, e.g. '01/07/2026', or null. */
  expiry: string | null
}

export type MatrixPdfRow = {
  worker: string
  role: string
  company: string | null
  cells: MatrixPdfCell[]
}

export type TrainingMatrixPdfProps = {
  company: DocCompany
  printedDate: string
  /** Column headers — the required competency types. */
  typeNames: string[]
  rows: MatrixPdfRow[]
}

const FOOTER_HEIGHT = 40

const STATUS_TEXT: Record<NonNullable<MatrixPdfCell['status']>, string> = {
  current: 'Current',
  expiring: 'Expiring',
  expired: 'EXPIRED',
  missing: 'Missing',
}

const STATUS_COLOUR: Record<NonNullable<MatrixPdfCell['status']>, string> = {
  current: '#16a34a',
  expiring: '#d97706',
  expired: '#dc2626',
  missing: palette.slate500,
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
    fontSize: 6.5,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    paddingHorizontal: 2,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  workerCell: { fontSize: fontSize.sm, color: palette.slate900, paddingHorizontal: 2 },
  workerSub: { fontSize: fontSize.xs, color: palette.slate500 },
  cell: {
    fontSize: fontSize.xs,
    paddingHorizontal: 2,
    textAlign: 'center',
  },
  cellExpiry: {
    fontSize: 6,
    color: palette.slate500,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

const col = StyleSheet.create({
  worker: { width: 120 },
  type: { flex: 1 },
})

/**
 * Competency matrix snapshot (ISO 7.2): active workers × required competency
 * types with the derived status per cell — current / expiring ≤30 days /
 * expired / missing (required but no record) / blank (not required for role).
 */
export function TrainingMatrixPdf({
  company,
  printedDate,
  typeNames,
  rows,
}: TrainingMatrixPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title="Competency Matrix" author={company.name}>
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
            <Text style={headerStyles.title}>Competency Matrix</Text>
            <Text style={headerStyles.docNumber}>Training register — ISO 7.2</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        <View style={styles.headRow} fixed>
          <Text style={[styles.headCell, col.worker]}>Worker</Text>
          {typeNames.map((name, i) => (
            <Text key={i} style={[styles.headCell, col.type]}>
              {name}
            </Text>
          ))}
        </View>

        {rows.map((r, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <View style={col.worker}>
              <Text style={styles.workerCell}>{r.worker}</Text>
              <Text style={styles.workerSub}>
                {[r.role, r.company].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {r.cells.map((cell, j) => (
              <View key={j} style={col.type}>
                {cell.status === null ? (
                  <Text style={[styles.cell, { color: palette.slate300 }]}>—</Text>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.cell,
                        {
                          color: STATUS_COLOUR[cell.status],
                          fontFamily:
                            cell.status === 'expired' ? font.bold : font.regular,
                        },
                      ]}
                    >
                      {STATUS_TEXT[cell.status]}
                    </Text>
                    {cell.expiry ? (
                      <Text style={styles.cellExpiry}>{cell.expiry}</Text>
                    ) : null}
                  </>
                )}
              </View>
            ))}
          </View>
        ))}

        {rows.length === 0 && (
          <Text style={[styles.workerSub, { marginTop: 10 }]}>
            No active workers on the register.
          </Text>
        )}

        <View style={styles.legend}>
          <Text>Current = valid beyond 30 days</Text>
          <Text>Expiring = expires within 30 days</Text>
          <Text>EXPIRED = past expiry</Text>
          <Text>Missing = required for role, no record</Text>
          <Text>— = not required for role</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Competency Matrix — training &amp; competency register (ISO 7.2)
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
