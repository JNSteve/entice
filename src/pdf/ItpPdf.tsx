import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'

export type ItpPdfItem = {
  position: number
  description: string
  acceptance_criteria: string
  spec_ref: string | null
  point_type: string // hold | witness | surveillance
  record_required: boolean
  responsible: string | null
  status: string // pending | passed | failed | na
  checked_by: string | null
  checked_at: string | null
}

export type ItpPdfProps = {
  itp: {
    number: string
    title: string
    activity: string
    status: string
    project: string
    adoptedAt: string
    adoptedBy: string | null
    lotCount: number
  }
  company: DocCompany
  items: ItpPdfItem[]
}

const styles = StyleSheet.create({
  metaBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingBottom: 12,
  },
  metaItem: { flexDirection: 'column', gap: 2, minWidth: 100 },
  metaLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: { fontSize: fontSize.base, color: palette.slate900 },
  legend: {
    marginTop: 10,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
  pointCell: { fontFamily: font.bold },
})

const col = StyleSheet.create({
  pos: { width: '4%' },
  description: { width: '26%' },
  criteria: { width: '30%' },
  spec: { width: '12%' },
  point: { width: '7%' },
  responsible: { width: '11%' },
  status: { width: '10%' },
})

const POINT_ABBREV: Record<string, string> = {
  hold: 'H',
  witness: 'W',
  surveillance: 'S',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'FAILED',
  na: 'N/A',
}

function statusColor(status: string): string {
  if (status === 'passed') return '#15803d'
  if (status === 'failed') return '#dc2626'
  return palette.slate500
}

/**
 * ITP instance checklist PDF — the adopted plan with per-item point types
 * (Hold / Witness / Surveillance), acceptance criteria, spec references and
 * live statuses. ISO 9001 8.5.1 controlled-conditions evidence.
 */
export function ItpPdf({ itp, company, items }: ItpPdfProps) {
  const metaRows = [
    { label: 'Project', value: itp.project },
    { label: 'Activity', value: itp.activity },
    { label: 'Status', value: itp.status },
    { label: 'Adopted', value: itp.adoptedAt },
    { label: 'Adopted by', value: itp.adoptedBy ?? '—' },
    { label: 'Lots', value: String(itp.lotCount) },
  ]

  return (
    <DocShell
      title="Inspection & Test Plan"
      docNumber={itp.number}
      docDate={itp.adoptedAt}
      company={company}
    >
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: fontSize.md,
          color: palette.navy,
          marginBottom: 8,
        }}
      >
        {itp.title}
      </Text>

      <View style={styles.metaBlock}>
        {metaRows.map((m) => (
          <View key={m.label} style={styles.metaItem}>
            <Text style={styles.metaLabel}>{m.label}</Text>
            <Text style={styles.metaValue}>{m.value}</Text>
          </View>
        ))}
      </View>

      <View style={tableStyles.table}>
        <View style={tableStyles.headRow}>
          <Text style={[tableStyles.headCell, col.pos]}>#</Text>
          <Text style={[tableStyles.headCell, col.description]}>
            Inspection / test
          </Text>
          <Text style={[tableStyles.headCell, col.criteria]}>
            Acceptance criteria
          </Text>
          <Text style={[tableStyles.headCell, col.spec]}>Spec ref</Text>
          <Text style={[tableStyles.headCell, col.point]}>Point</Text>
          <Text style={[tableStyles.headCell, col.responsible]}>
            Responsible
          </Text>
          <Text style={[tableStyles.headCell, col.status]}>Status</Text>
        </View>
        {items.map((it) => (
          <View key={it.position} style={tableStyles.row} wrap={false}>
            <Text style={[tableStyles.cellMuted, col.pos]}>{it.position}</Text>
            <Text style={[tableStyles.cell, col.description]}>
              {it.description}
              {it.record_required ? '' : ' (no record req.)'}
            </Text>
            <Text style={[tableStyles.cellMuted, col.criteria]}>
              {it.acceptance_criteria}
            </Text>
            <Text style={[tableStyles.cellMuted, col.spec]}>
              {it.spec_ref ?? '—'}
            </Text>
            <Text style={[tableStyles.cell, col.point, styles.pointCell]}>
              {POINT_ABBREV[it.point_type] ?? it.point_type}
            </Text>
            <Text style={[tableStyles.cellMuted, col.responsible]}>
              {it.responsible ?? '—'}
            </Text>
            <View style={[col.status, { paddingVertical: 4, paddingHorizontal: 4 }]}>
              <Text
                style={{
                  fontSize: fontSize.sm,
                  fontFamily: font.bold,
                  color: statusColor(it.status),
                }}
              >
                {STATUS_LABEL[it.status] ?? it.status}
              </Text>
              {it.checked_by ? (
                <Text style={{ fontSize: fontSize.xs, color: palette.slate500 }}>
                  {it.checked_by}
                  {it.checked_at ? ` ${it.checked_at}` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.legend}>
        Point types: H = Hold (work must not proceed past this point until
        released) · W = Witness (nominated party offered the opportunity to
        attend) · S = Surveillance (monitored in the course of the work).
        Items were copied from the template at adoption — template edits do
        not alter this ITP.
      </Text>
    </DocShell>
  )
}
