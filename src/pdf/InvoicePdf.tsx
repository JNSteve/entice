import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { aud, pct } from '@/lib/format'
import { lineTotal } from '@/lib/money'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles, totalsStyles } from './theme'

export type InvoicePdfLine = {
  description: string
  qty: number
  unit: string
  unit_sell: number
}

export type InvoicePdfPayment = {
  /** Pre-formatted display date. */
  date: string
  amount: number
  method?: string | null
  reference?: string | null
}

export type InvoicePdfProps = {
  invoice: {
    number: string
    /** Pre-formatted display date (issue date). */
    date: string
    /** Pre-formatted display date, or null when unset. */
    dueDate: string | null
    clientName: string
    jobNumber?: string | null
    jobTitle?: string | null
  }
  company: DocCompany
  lines: InvoicePdfLine[]
  totals: { subtotal: number; gst: number; gstRate: number; total: number }
  payments: InvoicePdfPayment[]
  /** Total inc GST less payments received. */
  balanceDue: number
  footerText?: string | null
}

const styles = StyleSheet.create({
  toBlock: {
    marginBottom: 14,
    gap: 2,
  },
  toLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  toName: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  toLine: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  paymentsBlock: {
    alignSelf: 'flex-end',
    width: 240,
    marginTop: 10,
  },
  paymentsTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  paymentLabel: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  paymentValue: {
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    backgroundColor: palette.slate100,
  },
  balanceLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  balanceValue: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  terms: {
    fontFamily: font.oblique,
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 16,
  },
})

// Column widths — Description | Qty | Unit | Rate | Total
const col = StyleSheet.create({
  description: { width: '46%' },
  qty: { width: '10%' },
  unit: { width: '12%' },
  rate: { width: '16%' },
  total: { width: '16%' },
})

/** Trim trailing zeros from a qty (numeric 12,3): 2.000 → "2", 1.250 → "1.25". */
function fmtQty(n: number): string {
  return String(parseFloat(n.toFixed(3)))
}

/**
 * Client-facing tax invoice on the shared DocShell: bill-to block, flat line
 * table, totals, payments received (when any) and payment terms.
 */
export function InvoicePdf({
  invoice,
  company,
  lines,
  totals,
  payments,
  balanceDue,
  footerText,
}: InvoicePdfProps) {
  return (
    <DocShell
      title="Tax Invoice"
      docNumber={invoice.number}
      docDate={invoice.date}
      company={company}
      footerText={footerText}
    >
      <View style={styles.toBlock}>
        <Text style={styles.toLabel}>Bill to</Text>
        <Text style={styles.toName}>{invoice.clientName}</Text>
        {invoice.jobNumber ? (
          <Text style={styles.toLine}>
            Re: {[invoice.jobNumber, invoice.jobTitle].filter(Boolean).join(' — ')}
          </Text>
        ) : null}
      </View>

      <View style={tableStyles.table} wrap>
        <View style={tableStyles.headRow}>
          <Text style={[tableStyles.headCell, col.description]}>Description</Text>
          <Text style={[tableStyles.headCell, col.qty, tableStyles.right]}>Qty</Text>
          <Text style={[tableStyles.headCell, col.unit, tableStyles.right]}>Unit</Text>
          <Text style={[tableStyles.headCell, col.rate, tableStyles.right]}>Rate</Text>
          <Text style={[tableStyles.headCell, col.total, tableStyles.right]}>Total</Text>
        </View>
        {lines.map((line, i) => (
          <View key={i} style={tableStyles.row} wrap={false}>
            <Text style={[tableStyles.cell, col.description]}>{line.description}</Text>
            <Text style={[tableStyles.cell, col.qty, tableStyles.right]}>{fmtQty(line.qty)}</Text>
            <Text style={[tableStyles.cellMuted, col.unit, tableStyles.right]}>{line.unit}</Text>
            <Text style={[tableStyles.cell, col.rate, tableStyles.right]}>{aud(line.unit_sell)}</Text>
            <Text style={[tableStyles.cell, col.total, tableStyles.right]}>
              {aud(lineTotal(line.qty, line.unit_sell))}
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

      {payments.length > 0 ? (
        <View style={styles.paymentsBlock} wrap={false}>
          <Text style={styles.paymentsTitle}>Payments received</Text>
          {payments.map((p, i) => (
            <View key={i} style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>
                {[p.date, p.reference].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.paymentValue}>{aud(p.amount)}</Text>
            </View>
          ))}
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Balance due</Text>
            <Text style={styles.balanceValue}>{aud(balanceDue)}</Text>
          </View>
        </View>
      ) : null}

      {invoice.dueDate ? (
        <Text style={styles.terms}>Payment due by {invoice.dueDate}.</Text>
      ) : null}
    </DocShell>
  )
}
