import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type WasteLoadsPdfRow = {
  number: string
  date: string
  target: string
  classification: string
  detail: string | null
  qty: string
  facility: string | null
  transporter: string | null
  docket: string | null
  permit: string | null
  /** Logged with a gating override (reason on the record). */
  override: boolean
}

export type WasteLoadsPdfProps = {
  company: DocCompany
  printedDate: string
  /** Echo of the active register filters (e.g. 'Project P-0003 · Asbestos waste · 01/06/2026 – 30/06/2026'). */
  filtersLabel: string | null
  rows: WasteLoadsPdfRow[]
  /** e.g. '142.5 t · 36 m³ across 18 loads' */
  totalsLabel: string
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

  filters: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 10,
    marginBottom: 2,
  },
  totals: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    marginTop: 6,
  },
  headRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate100,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginTop: 6,
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
  override: { color: '#d97706', fontFamily: font.bold },
})

// Landscape column widths.
const col = StyleSheet.create({
  num: { width: 58 },
  date: { width: 58 },
  target: { flex: 1 },
  classification: { flex: 1 },
  qty: { width: 55, textAlign: 'right' as const },
  facility: { flex: 1.2 },
  transporter: { width: 80 },
  docket: { width: 70 },
  permit: { width: 80 },
})

/**
 * Waste loads register export (ISO 14001 8.1 / 9.1) — every load leaving site
 * with classification, quantity, receiving facility and docket reference,
 * echoing the on-screen filters used to produce it.
 */
export function WasteLoadsPdf({
  company,
  printedDate,
  filtersLabel,
  rows,
  totalsLabel,
}: WasteLoadsPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title="Waste Loads Register" author={company.name}>
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
            <Text style={headerStyles.title}>Waste Loads Register</Text>
            <Text style={headerStyles.docNumber}>ISO 14001 8.1 / 9.1</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        <Text style={styles.filters}>
          {filtersLabel ? `Filters: ${filtersLabel}` : 'Filters: none (full register)'}
        </Text>
        <Text style={styles.totals}>{totalsLabel}</Text>

        <View style={styles.headRow}>
          <Text style={[styles.headCell, col.num]}>Number</Text>
          <Text style={[styles.headCell, col.date]}>Date</Text>
          <Text style={[styles.headCell, col.target]}>Project / job</Text>
          <Text style={[styles.headCell, col.classification]}>Classification</Text>
          <Text style={[styles.headCell, col.qty]}>Qty</Text>
          <Text style={[styles.headCell, col.facility]}>Facility</Text>
          <Text style={[styles.headCell, col.transporter]}>Transporter</Text>
          <Text style={[styles.headCell, col.docket]}>Docket</Text>
          <Text style={[styles.headCell, col.permit]}>Permit</Text>
        </View>
        {rows.map((r) => (
          <View key={r.number} style={styles.row} wrap={false}>
            <Text style={[styles.cell, col.num]}>
              {r.number}
              {r.override ? ' *' : ''}
            </Text>
            <Text style={[styles.cellMuted, col.date]}>{r.date}</Text>
            <Text style={[styles.cellMuted, col.target]}>{r.target}</Text>
            <Text style={[styles.cell, col.classification]}>
              {r.classification}
              {r.detail ? ` — ${r.detail}` : ''}
            </Text>
            <Text style={[styles.cell, col.qty]}>{r.qty}</Text>
            <Text style={[styles.cellMuted, col.facility]}>{r.facility ?? '—'}</Text>
            <Text style={[styles.cellMuted, col.transporter]}>
              {r.transporter ?? '—'}
            </Text>
            <Text style={[styles.cellMuted, col.docket]}>{r.docket ?? '—'}</Text>
            <Text style={[styles.cellMuted, col.permit]}>{r.permit ?? '—'}</Text>
          </View>
        ))}
        {rows.length === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 10 }]}>
            No waste loads match the filters.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Waste Loads Register — every load leaving site is a numbered record
            with docket evidence attached in Entice. Rows marked * were logged
            with a gating override (reason recorded on the load). Quantities
            are per-load in the unit recorded at the gate (m³ or t) — units are
            never converted.
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
