import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'

export type LotPdfItem = {
  position: number
  description: string
  acceptance_criteria: string
  spec_ref: string | null
  point_type: string
  item_status: string // instance-item status (na strikes the row out)
  result: string | null // latest inspection result for THIS lot: pass | fail
  inspected_by: string | null
  inspected_at: string | null
  ncr_number: string | null
}

export type LotPdfTest = {
  test_type: string
  description: string
  value: string | null // pre-formatted with uom
  spec: string | null // pre-formatted range
  pass: boolean
  lab_ref: string | null
  tested_on: string | null
  ncr_number: string | null
}

export type LotPdfHoldPoint = {
  title: string
  required_by: string
  status: string
  released_at: string | null
  released_by: string | null
  release_ref: string | null
}

export type LotPdfProps = {
  lot: {
    number: string
    description: string
    location: string | null
    project: string
    itp: string // "ITP-0001 — Bulk Earthworks & Subgrade"
    status: string
    conformance: string // live lot_conformance() verdict
    openedOn: string
    closedAt: string | null
    closedBy: string | null
    ncrNumbers: string[] // all NCRs referenced by this lot's records
    attachmentCount: number
  }
  company: DocCompany
  items: LotPdfItem[]
  tests: LotPdfTest[]
  holdPoints: LotPdfHoldPoint[]
}

const styles = StyleSheet.create({
  metaBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingBottom: 12,
  },
  metaItem: { flexDirection: 'column', gap: 2, minWidth: 90 },
  metaLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: { fontSize: fontSize.base, color: palette.slate900 },
  section: { marginBottom: 12 },
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
  verdictBox: {
    borderWidth: 1,
    borderRadius: 3,
    padding: 10,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  verdictLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  verdictValue: {
    fontFamily: font.bold,
    fontSize: fontSize.lg,
    textTransform: 'uppercase',
  },
  footer: { marginTop: 10, fontSize: fontSize.xs, color: palette.slate500 },
})

const itemCol = StyleSheet.create({
  pos: { width: '4%' },
  description: { width: '34%' },
  criteria: { width: '30%' },
  point: { width: '8%' },
  result: { width: '24%' },
})

const testCol = StyleSheet.create({
  type: { width: '14%' },
  description: { width: '30%' },
  value: { width: '14%' },
  spec: { width: '14%' },
  lab: { width: '14%' },
  result: { width: '14%' },
})

const hpCol = StyleSheet.create({
  title: { width: '40%' },
  required: { width: '18%' },
  status: { width: '12%' },
  release: { width: '30%' },
})

const GREEN = '#15803d'
const RED = '#dc2626'
const AMBER = '#b45309'

function verdictColor(v: string): string {
  if (v === 'conforming' || v === 'closed') return GREEN
  if (v === 'nonconforming') return RED
  return AMBER
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Lot Conformance Report — the per-lot acceptance record an auditor or head
 * contractor reads: lot info, per-item inspection results, test results, hold
 * point releases, linked NCRs and the computed conformance verdict
 * (ISO 9001 8.6 release of products and services / 8.7 nonconforming outputs).
 */
export function LotPdf({ lot, company, items, tests, holdPoints }: LotPdfProps) {
  const verdict = lot.status === 'closed' ? 'closed' : lot.conformance
  const verdictText =
    lot.status === 'closed'
      ? 'CLOSED — CONFORMING'
      : lot.conformance.toUpperCase()
  const colour = verdictColor(verdict)

  const metaRows = [
    { label: 'Project', value: lot.project },
    { label: 'ITP', value: lot.itp },
    { label: 'Location', value: lot.location ?? '—' },
    { label: 'Opened', value: lot.openedOn },
    {
      label: 'Closed',
      value: lot.closedAt
        ? `${lot.closedAt}${lot.closedBy ? ` by ${lot.closedBy}` : ''}`
        : 'Open',
    },
    {
      label: 'Linked NCRs',
      value: lot.ncrNumbers.length > 0 ? lot.ncrNumbers.join(', ') : 'None',
    },
  ]

  return (
    <DocShell
      title="Lot Conformance Report"
      docNumber={lot.number}
      docDate={lot.openedOn}
      company={company}
      footerText={`Conformance is computed from the inspection, test and hold-point records (never hand-set).`}
    >
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: fontSize.md,
          color: palette.navy,
          marginBottom: 8,
        }}
      >
        {lot.description}
      </Text>

      <View style={styles.metaBlock}>
        {metaRows.map((m) => (
          <View key={m.label} style={styles.metaItem}>
            <Text style={styles.metaLabel}>{m.label}</Text>
            <Text style={styles.metaValue}>{m.value}</Text>
          </View>
        ))}
      </View>

      {/* Conformance verdict */}
      <View style={[styles.verdictBox, { borderColor: colour }]}>
        <Text style={[styles.verdictLabel, { color: palette.slate700 }]}>
          Conformance verdict
        </Text>
        <Text style={[styles.verdictValue, { color: colour }]}>
          {verdictText}
        </Text>
      </View>

      {/* Inspection records */}
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>
          ITP items — latest inspection result for this lot
        </Text>
        <View style={tableStyles.table}>
          <View style={tableStyles.headRow}>
            <Text style={[tableStyles.headCell, itemCol.pos]}>#</Text>
            <Text style={[tableStyles.headCell, itemCol.description]}>
              Inspection / test
            </Text>
            <Text style={[tableStyles.headCell, itemCol.criteria]}>
              Acceptance criteria
            </Text>
            <Text style={[tableStyles.headCell, itemCol.point]}>Point</Text>
            <Text style={[tableStyles.headCell, itemCol.result]}>Result</Text>
          </View>
          {items.map((it) => (
            <View key={it.position} style={tableStyles.row} wrap={false}>
              <Text style={[tableStyles.cellMuted, itemCol.pos]}>
                {it.position}
              </Text>
              <Text style={[tableStyles.cell, itemCol.description]}>
                {it.description}
              </Text>
              <Text style={[tableStyles.cellMuted, itemCol.criteria]}>
                {it.acceptance_criteria}
                {it.spec_ref ? ` — ${it.spec_ref}` : ''}
              </Text>
              <Text style={[tableStyles.cell, itemCol.point]}>
                {cap(it.point_type)}
              </Text>
              <View
                style={[itemCol.result, { paddingVertical: 4, paddingHorizontal: 4 }]}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    fontFamily: font.bold,
                    color:
                      it.item_status === 'na'
                        ? palette.slate500
                        : it.result === 'pass'
                          ? GREEN
                          : it.result === 'fail'
                            ? RED
                            : AMBER,
                  }}
                >
                  {it.item_status === 'na'
                    ? 'N/A'
                    : it.result
                      ? it.result === 'pass'
                        ? 'PASS'
                        : `FAIL${it.ncr_number ? ` — ${it.ncr_number}` : ''}`
                      : 'Not inspected'}
                </Text>
                {it.inspected_by ? (
                  <Text style={{ fontSize: fontSize.xs, color: palette.slate500 }}>
                    {it.inspected_by}
                    {it.inspected_at ? ` · ${it.inspected_at}` : ''}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Test results */}
      {tests.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Test results</Text>
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, testCol.type]}>Type</Text>
              <Text style={[tableStyles.headCell, testCol.description]}>
                Description
              </Text>
              <Text style={[tableStyles.headCell, testCol.value]}>Result</Text>
              <Text style={[tableStyles.headCell, testCol.spec]}>Spec</Text>
              <Text style={[tableStyles.headCell, testCol.lab]}>
                Lab ref / date
              </Text>
              <Text style={[tableStyles.headCell, testCol.result]}>
                Pass / fail
              </Text>
            </View>
            {tests.map((t, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, testCol.type]}>
                  {t.test_type}
                </Text>
                <Text style={[tableStyles.cell, testCol.description]}>
                  {t.description}
                </Text>
                <Text style={[tableStyles.cellMuted, testCol.value]}>
                  {t.value ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, testCol.spec]}>
                  {t.spec ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, testCol.lab]}>
                  {t.lab_ref ?? '—'}
                  {t.tested_on ? ` · ${t.tested_on}` : ''}
                </Text>
                <Text
                  style={[
                    tableStyles.cell,
                    testCol.result,
                    { fontFamily: font.bold, color: t.pass ? GREEN : RED },
                  ]}
                >
                  {t.pass ? 'PASS' : `FAIL${t.ncr_number ? ` — ${t.ncr_number}` : ''}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Hold point releases */}
      {holdPoints.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Hold points</Text>
          <View style={tableStyles.table}>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, hpCol.title]}>Hold point</Text>
              <Text style={[tableStyles.headCell, hpCol.required]}>
                Required by
              </Text>
              <Text style={[tableStyles.headCell, hpCol.status]}>Status</Text>
              <Text style={[tableStyles.headCell, hpCol.release]}>Release</Text>
            </View>
            {holdPoints.map((hp, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, hpCol.title]}>{hp.title}</Text>
                <Text style={[tableStyles.cellMuted, hpCol.required]}>
                  {hp.required_by}
                </Text>
                <Text
                  style={[
                    tableStyles.cell,
                    hpCol.status,
                    {
                      fontFamily: font.bold,
                      color: hp.status === 'released' ? GREEN : RED,
                    },
                  ]}
                >
                  {cap(hp.status)}
                </Text>
                <Text style={[tableStyles.cellMuted, hpCol.release]}>
                  {hp.status === 'released'
                    ? `${hp.released_by ?? '—'}${hp.release_ref ? ` · ${hp.release_ref}` : ''}${hp.released_at ? ` · ${hp.released_at}` : ''}`
                    : 'Not released'}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {lot.attachmentCount > 0 ? (
        <Text style={styles.footer}>
          {lot.attachmentCount} evidence attachment
          {lot.attachmentCount === 1 ? '' : 's'} on file (view online).
        </Text>
      ) : null}
    </DocShell>
  )
}
