import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { aud, pct } from '@/lib/format'
import { lineTotal } from '@/lib/money'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles, totalsStyles } from './theme'

export type PoPdfLine = {
  description: string
  cost_code: string | null
  qty: number
  unit: string
  unit_cost: number
}

export type PoPdfProps = {
  po: {
    number: string
    /** Pre-formatted display date (issue date or creation date). */
    date: string
    vendorName: string
    vendorEmail?: string | null
    vendorPhone?: string | null
    /** Deliver-to: site address or project name. */
    deliverTo: string
    notes?: string | null
    status: string
  }
  company: DocCompany
  lines: PoPdfLine[]
  totals: { subtotal: number; gst: number; gstRate: number; total: number }
}

const styles = StyleSheet.create({
  toBlock: {
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  vendorBlock: {
    flexDirection: 'column',
    gap: 2,
  },
  deliverBlock: {
    flexDirection: 'column',
    gap: 2,
  },
  blockLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  vendorName: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  vendorLine: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  deliverTo: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  notes: {
    fontSize: fontSize.base,
    color: palette.slate700,
    lineHeight: 1.5,
    marginTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: palette.slate200,
    paddingTop: 8,
  },
  draftBadge: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  cancelledBadge: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: '#b91c1c',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
})

// Column widths — Description | Cost code | Qty | Unit | Rate | Total
const col = StyleSheet.create({
  description: { width: '36%' },
  costCode: { width: '16%' },
  qty: { width: '9%' },
  unit: { width: '9%' },
  rate: { width: '15%' },
  total: { width: '15%' },
})

function fmtQty(n: number): string {
  return String(parseFloat(n.toFixed(3)))
}

/**
 * Vendor-facing Purchase Order PDF. Shows vendor, deliver-to address, flat
 * line table with cost codes, totals, and notes.
 * Draft POs include a subtle "DRAFT" marker; cancelled show "CANCELLED".
 */
export function PoPdf({ po, company, lines, totals }: PoPdfProps) {
  const isDraft = po.status === 'draft'
  const isCancelled = po.status === 'cancelled'

  return (
    <DocShell
      title="Purchase Order"
      docNumber={po.number}
      docDate={po.date}
      company={company}
    >
      {isDraft ? (
        <Text style={styles.draftBadge}>Draft — Not yet issued</Text>
      ) : isCancelled ? (
        <Text style={styles.cancelledBadge}>Cancelled</Text>
      ) : null}

      <View style={styles.toBlock}>
        <View style={styles.vendorBlock}>
          <Text style={styles.blockLabel}>Vendor</Text>
          <Text style={styles.vendorName}>{po.vendorName}</Text>
          {po.vendorEmail ? (
            <Text style={styles.vendorLine}>{po.vendorEmail}</Text>
          ) : null}
          {po.vendorPhone ? (
            <Text style={styles.vendorLine}>{po.vendorPhone}</Text>
          ) : null}
        </View>
        <View style={styles.deliverBlock}>
          <Text style={styles.blockLabel}>Deliver to</Text>
          <Text style={styles.deliverTo}>{po.deliverTo}</Text>
        </View>
      </View>

      <View style={tableStyles.table} wrap>
        <View style={tableStyles.headRow}>
          <Text style={[tableStyles.headCell, col.description]}>Description</Text>
          <Text style={[tableStyles.headCell, col.costCode]}>Cost code</Text>
          <Text style={[tableStyles.headCell, col.qty, tableStyles.right]}>Qty</Text>
          <Text style={[tableStyles.headCell, col.unit, tableStyles.right]}>Unit</Text>
          <Text style={[tableStyles.headCell, col.rate, tableStyles.right]}>Rate</Text>
          <Text style={[tableStyles.headCell, col.total, tableStyles.right]}>Total</Text>
        </View>
        {lines.map((line, i) => (
          <View key={i} style={tableStyles.row} wrap={false}>
            <Text style={[tableStyles.cell, col.description]}>{line.description}</Text>
            <Text style={[tableStyles.cellMuted, col.costCode]}>{line.cost_code ?? '—'}</Text>
            <Text style={[tableStyles.cell, col.qty, tableStyles.right]}>{fmtQty(line.qty)}</Text>
            <Text style={[tableStyles.cellMuted, col.unit, tableStyles.right]}>{line.unit}</Text>
            <Text style={[tableStyles.cell, col.rate, tableStyles.right]}>{aud(line.unit_cost)}</Text>
            <Text style={[tableStyles.cell, col.total, tableStyles.right]}>
              {aud(lineTotal(line.qty, line.unit_cost))}
            </Text>
          </View>
        ))}
      </View>

      <View style={totalsStyles.block} wrap={false}>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>Subtotal (ex GST)</Text>
          <Text style={totalsStyles.value}>{aud(totals.subtotal)}</Text>
        </View>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>GST {pct(totals.gstRate)}</Text>
          <Text style={totalsStyles.value}>{aud(totals.gst)}</Text>
        </View>
        <View style={totalsStyles.grandRow}>
          <Text style={totalsStyles.grandLabel}>Total inc GST</Text>
          <Text style={totalsStyles.grandValue}>{aud(totals.total)}</Text>
        </View>
      </View>

      {po.notes ? (
        <Text style={styles.notes}>{po.notes}</Text>
      ) : null}
    </DocShell>
  )
}
