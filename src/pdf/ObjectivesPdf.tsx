import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type ObjectivesPdfSummaryRow = {
  number: string
  title: string
  domain: string
  metric: string
  /** Font-safe wording (WinAnsi has no ≤/≥ glyphs) — e.g. 'at most 0' / 'at least 95%' */
  target: string
  period: string
  source: string
  latestPeriod: string | null
  latestValue: string | null
  /** on_track / at_risk / off_track / no_data */
  traffic: string
  trafficLabel: string
  owner: string | null
  status: string
}

export type ObjectivesPdfValueRow = {
  period: string
  value: string
  trafficLabel: string
  traffic: string
  note: string | null
  source: string
  recorded: string
}

export type ObjectivesPdfObjectiveBlock = {
  number: string
  title: string
  metric: string
  target: string
  values: ObjectivesPdfValueRow[]
}

export type ObjectivesPdfProps = {
  company: DocCompany
  printedDate: string
  summary: ObjectivesPdfSummaryRow[]
  blocks: ObjectivesPdfObjectiveBlock[]
}

const FOOTER_HEIGHT = 40

const TRAFFIC_COLORS: Record<string, string> = {
  on_track: '#16a34a',
  at_risk: '#d97706',
  off_track: '#dc2626',
  no_data: palette.slate500,
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
  traffic: { fontFamily: font.bold },
  blockTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.navy,
    marginTop: 10,
    marginBottom: 2,
  },
  blockMeta: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginBottom: 3,
  },
})

// Landscape summary column widths.
const col = StyleSheet.create({
  num: { width: 50 },
  title: { flex: 1 },
  domain: { width: 78 },
  metric: { width: 92 },
  target: { width: 58 },
  period: { width: 48 },
  source: { width: 50 },
  latest: { width: 88 },
  traffic: { width: 52 },
  owner: { width: 64 },
  status: { width: 44 },
})

// Per-objective period table columns.
const vcol = StyleSheet.create({
  period: { width: 70 },
  value: { width: 70 },
  traffic: { width: 60 },
  note: { flex: 1 },
  source: { width: 80 },
  recorded: { width: 60 },
})

/**
 * Objectives & KPIs export (ISO 6.2 / 9.1) for the management-review pack:
 * a summary of every objective with its latest value, target and
 * direction-aware traffic status, then a period-by-period value table per
 * objective. Auto values are engine-derived; manual values are attributed.
 */
export function ObjectivesPdf({
  company,
  printedDate,
  summary,
  blocks,
}: ObjectivesPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title="Objectives & KPIs" author={company.name}>
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
            <Text style={headerStyles.title}>Objectives & KPIs</Text>
            <Text style={headerStyles.docNumber}>ISO 6.2 / 9.1</Text>
            <Text style={headerStyles.docDate}>Printed {printedDate}</Text>
          </View>
        </View>

        {/* Summary */}
        <Text style={styles.sectionTitle}>
          Objectives summary — {summary.length} objective
          {summary.length === 1 ? '' : 's'}
        </Text>
        <View style={styles.headRow}>
          <Text style={[styles.headCell, col.num]}>Number</Text>
          <Text style={[styles.headCell, col.title]}>Objective</Text>
          <Text style={[styles.headCell, col.domain]}>Domain</Text>
          <Text style={[styles.headCell, col.metric]}>KPI</Text>
          <Text style={[styles.headCell, col.target]}>Target</Text>
          <Text style={[styles.headCell, col.period]}>Period</Text>
          <Text style={[styles.headCell, col.source]}>Source</Text>
          <Text style={[styles.headCell, col.latest]}>Latest</Text>
          <Text style={[styles.headCell, col.traffic]}>Status</Text>
          <Text style={[styles.headCell, col.owner]}>Owner</Text>
          <Text style={[styles.headCell, col.status]}>Lifecycle</Text>
        </View>
        {summary.map((r) => (
          <View key={r.number} style={styles.row} wrap={false}>
            <Text style={[styles.cellMuted, col.num]}>{r.number}</Text>
            <Text style={[styles.cell, col.title]}>{r.title}</Text>
            <Text style={[styles.cellMuted, col.domain]}>{r.domain}</Text>
            <Text style={[styles.cellMuted, col.metric]}>{r.metric}</Text>
            <Text style={[styles.cell, col.target]}>{r.target}</Text>
            <Text style={[styles.cellMuted, col.period]}>{r.period}</Text>
            <Text style={[styles.cellMuted, col.source]}>{r.source}</Text>
            <Text style={[styles.cell, col.latest]}>
              {r.latestValue != null && r.latestPeriod
                ? `${r.latestValue} (${r.latestPeriod})`
                : '—'}
            </Text>
            <Text
              style={[
                styles.cell,
                styles.traffic,
                col.traffic,
                { color: TRAFFIC_COLORS[r.traffic] ?? palette.slate900 },
              ]}
            >
              {r.trafficLabel}
            </Text>
            <Text style={[styles.cellMuted, col.owner]}>{r.owner ?? '—'}</Text>
            <Text style={[styles.cellMuted, col.status]}>{r.status}</Text>
          </View>
        ))}
        {summary.length === 0 && (
          <Text style={[styles.cellMuted, { marginTop: 10 }]}>
            No objectives on the register.
          </Text>
        )}

        {/* Per-objective period tables */}
        {blocks.map((b) => (
          <View key={b.number}>
            <Text style={styles.blockTitle}>
              {b.number} — {b.title}
            </Text>
            <Text style={styles.blockMeta}>
              {b.metric} · target {b.target}
            </Text>
            {b.values.length === 0 ? (
              <Text style={styles.cellMuted}>No period values recorded.</Text>
            ) : (
              <>
                <View style={styles.headRow}>
                  <Text style={[styles.headCell, vcol.period]}>Period</Text>
                  <Text style={[styles.headCell, vcol.value]}>Value</Text>
                  <Text style={[styles.headCell, vcol.traffic]}>Status</Text>
                  <Text style={[styles.headCell, vcol.note]}>Note</Text>
                  <Text style={[styles.headCell, vcol.source]}>Source</Text>
                  <Text style={[styles.headCell, vcol.recorded]}>Recorded</Text>
                </View>
                {b.values.map((v) => (
                  <View key={v.period} style={styles.row} wrap={false}>
                    <Text style={[styles.cell, vcol.period]}>{v.period}</Text>
                    <Text style={[styles.cell, vcol.value]}>{v.value}</Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.traffic,
                        vcol.traffic,
                        { color: TRAFFIC_COLORS[v.traffic] ?? palette.slate900 },
                      ]}
                    >
                      {v.trafficLabel}
                    </Text>
                    <Text style={[styles.cellMuted, vcol.note]}>
                      {v.note ?? '—'}
                    </Text>
                    <Text style={[styles.cellMuted, vcol.source]}>{v.source}</Text>
                    <Text style={[styles.cellMuted, vcol.recorded]}>
                      {v.recorded}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Objectives & KPIs — direction-aware status (at-most targets: lower
            is better; at-least targets: higher is better; amber within 10% of
            target). Auto values derived by the metrics engine; unmeasured
            periods carry no value.
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
