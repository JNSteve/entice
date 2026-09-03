import { View, Text, StyleSheet, type Styles } from '@react-pdf/renderer'
import { aud } from '@/lib/format'
import type { PricingModel, TotalsRows } from '@/lib/quote-pricing'
import { palette, fontSize, font, tableStyles, totalsStyles } from './theme'

/**
 * Prints a PricingModel (see src/lib/quote-pricing.ts). Shared by the
 * standard QuotePdf and the templated QuoteDocPdf. Sell side only.
 */

// Itemised: Description | Qty | Unit | Rate | Total
const colFull = StyleSheet.create({
  description: { width: '46%' },
  qty: { width: '10%' },
  unit: { width: '12%' },
  rate: { width: '16%' },
  total: { width: '16%' },
})
// Itemised without qty/unit: Description | Rate | Total
const colNoQty = StyleSheet.create({
  description: { width: '68%' },
  rate: { width: '16%' },
  total: { width: '16%' },
})
// Section totals: Description | Qty | Unit (or Description only)
const colSec = StyleSheet.create({
  description: { width: '78%' },
  qty: { width: '10%' },
  unit: { width: '12%' },
  descriptionOnly: { width: '100%' },
})

const styles = StyleSheet.create({
  itemListTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 8,
    marginBottom: 3,
  },
  itemListTitleFirst: { marginTop: 0 },
  itemRow: { flexDirection: 'row', gap: 5, paddingVertical: 1.5, paddingLeft: 4 },
  itemMark: { fontSize: fontSize.base, color: palette.slate500 },
  itemText: { flex: 1, fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.4 },
  lumpBlock: { alignSelf: 'flex-start', width: 300, marginTop: 2 },
  lumpBlockAfterItems: { alignSelf: 'flex-start', width: 300, marginTop: 12 },
})

/** react-pdf's Style, reached through the renderer's public Styles map. */
type PdfStyle = Styles[string]

function Totals({ totals, style }: { totals: TotalsRows; style?: PdfStyle }) {
  return (
    <View style={[totalsStyles.block, style ?? {}]} wrap={false}>
      {totals.rows.map((r, i) => (
        <View key={i} style={totalsStyles.row}>
          <Text style={totalsStyles.label}>{r.label}</Text>
          <Text style={totalsStyles.value}>{aud(r.value)}</Text>
        </View>
      ))}
      <View style={totalsStyles.grandRow}>
        <Text style={totalsStyles.grandLabel}>{totals.grand.label}</Text>
        <Text style={totalsStyles.grandValue}>{aud(totals.grand.value)}</Text>
      </View>
    </View>
  )
}

function SubtotalRow({ value }: { value: number }) {
  return (
    <View style={tableStyles.subtotalRow} wrap={false}>
      <Text style={tableStyles.subtotalLabel}>Section subtotal</Text>
      <Text style={tableStyles.subtotalValue}>{aud(value)}</Text>
    </View>
  )
}

export function PricingBlock({ model }: { model: PricingModel }) {
  if (model.mode === 'lump_sum') {
    // What the fee covers reads first; the money is the conclusion.
    return (
      <View>
        {model.itemLists.map((list, i) => (
          <View key={i}>
            <Text
              style={[styles.itemListTitle, i === 0 ? styles.itemListTitleFirst : {}]}
              minPresenceAhead={40}
            >
              {list.title}
            </Text>
            {list.items.map((item, j) => (
              <View key={j} style={styles.itemRow} wrap={false}>
                <Text style={styles.itemMark}>•</Text>
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
        <Totals
          totals={model.totals}
          style={model.itemLists.length > 0 ? styles.lumpBlockAfterItems : styles.lumpBlock}
        />
      </View>
    )
  }

  if (model.mode === 'section_totals') {
    const q = model.showQtyUnit
    return (
      <View>
        {model.sections.map((s, i) => (
          <View key={i} style={tableStyles.table} wrap>
            <View style={tableStyles.sectionTitleRow} minPresenceAhead={60}>
              <Text style={tableStyles.sectionTitle}>{s.title}</Text>
            </View>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, q ? colSec.description : colSec.descriptionOnly]}>Description</Text>
              {q ? <Text style={[tableStyles.headCell, colSec.qty, tableStyles.right]}>Qty</Text> : null}
              {q ? <Text style={[tableStyles.headCell, colSec.unit, tableStyles.right]}>Unit</Text> : null}
            </View>
            {s.lines.map((l, j) => (
              <View key={j} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, q ? colSec.description : colSec.descriptionOnly]}>{l.description}</Text>
                {q ? <Text style={[tableStyles.cell, colSec.qty, tableStyles.right]}>{l.qty}</Text> : null}
                {q ? <Text style={[tableStyles.cellMuted, colSec.unit, tableStyles.right]}>{l.unit}</Text> : null}
              </View>
            ))}
            <SubtotalRow value={s.subtotal} />
          </View>
        ))}
        <Totals totals={model.totals} />
      </View>
    )
  }

  const q = model.showQtyUnit
  const col = q ? colFull : colNoQty
  return (
    <View>
      {model.sections.map((s, i) => (
        <View key={i} style={tableStyles.table} wrap>
          <View style={tableStyles.sectionTitleRow} minPresenceAhead={60}>
            <Text style={tableStyles.sectionTitle}>{s.title}</Text>
          </View>
          <View style={tableStyles.headRow}>
            <Text style={[tableStyles.headCell, col.description]}>Description</Text>
            {q ? <Text style={[tableStyles.headCell, colFull.qty, tableStyles.right]}>Qty</Text> : null}
            {q ? <Text style={[tableStyles.headCell, colFull.unit, tableStyles.right]}>Unit</Text> : null}
            <Text style={[tableStyles.headCell, col.rate, tableStyles.right]}>Rate</Text>
            <Text style={[tableStyles.headCell, col.total, tableStyles.right]}>Total</Text>
          </View>
          {s.lines.map((l, j) => (
            <View key={j} style={tableStyles.row} wrap={false}>
              <Text style={[tableStyles.cell, col.description]}>{l.description}</Text>
              {q ? <Text style={[tableStyles.cell, colFull.qty, tableStyles.right]}>{l.qty}</Text> : null}
              {q ? <Text style={[tableStyles.cellMuted, colFull.unit, tableStyles.right]}>{l.unit}</Text> : null}
              <Text style={[tableStyles.cell, col.rate, tableStyles.right]}>{aud(l.rate)}</Text>
              <Text style={[tableStyles.cell, col.total, tableStyles.right]}>{aud(l.total)}</Text>
            </View>
          ))}
          <SubtotalRow value={s.subtotal} />
        </View>
      ))}
      <Totals totals={model.totals} />
    </View>
  )
}
